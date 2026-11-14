import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  createPgliteDatabase,
  SessionRepository,
  RunRepository,
  MessageRepository,
  EventRepository,
  ApprovalRepository,
  ProjectRepository,
  AgentRepository,
  ExecutionTargetRepository,
} from '@agenthub/db';
import { SessionService } from './session-service.js';
import type { AgentService } from '../agents/agent-service.js';
import { createApp } from '../app.js';
let db: Awaited<ReturnType<typeof createPgliteDatabase>>;
let service: SessionService;
let projectId: string, agentId: string;
const provider = vi.fn(() => {
  throw new Error('rename must not call Agent');
});
beforeAll(async () => {
  db = await createPgliteDatabase({ dataDir: 'memory://' });
  const target = await new ExecutionTargetRepository(db.db).create({
    id: randomUUID(),
    name: 'fixture',
    kind: 'LOCAL_HOST',
    hostname: 'fixture',
    os: 'linux',
    arch: 'x64',
    status: 'READY',
  });
  const projects = new ProjectRepository(db.db);
  projectId = (
    await projects.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'fixture',
      rootPath: '/tmp/fixture',
      realRootPath: '/tmp/fixture',
      repoKind: 'NONE',
      status: 'ACTIVE',
    })
  ).id;
  agentId = (
    await new AgentRepository(db.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: 'fixture',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    })
  ).id;
  service = new SessionService(
    new SessionRepository(db.db),
    new RunRepository(db.db),
    new MessageRepository(db.db),
    new EventRepository(db.db),
    new ApprovalRepository(db.db),
    projects,
    new Proxy({}, { get: () => provider }) as AgentService,
    { publish: vi.fn() },
  );
});
afterAll(async () => {
  await db.close();
});
it('strict title PATCH uses real CAS, GET/list revision and no Agent/runtime mutations', async () => {
  const original = await new SessionRepository(db.db).create({
    id: randomUUID(),
    projectId,
    agentId,
    title: '原名',
    cwd: '/tmp/fixture',
    status: 'RUNNING',
  });
  const app = createApp({ sessions: service });
  const url = `/api/v1/sessions/${original.id}/title`;
  const results = await Promise.all([
    request(app).patch(url).send({ title: '  新名 A  ', expectedRevision: 0 }),
    request(app).patch(url).send({ title: '新名 B', expectedRevision: 0 }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = results.find((r) => r.status === 200)!.body.data;
  expect(winner.titleRevision).toBe(1);
  expect(winner.title).toBe(winner.title.trim());
  expect(winner.status).toBe('RUNNING');
  expect(winner.lastActiveAt).toBe(original.lastActiveAt.toISOString());
  expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SESSION_TITLE_CONFLICT');
  expect((await request(app).get(`/api/v1/sessions/${original.id}`)).body.data).toMatchObject({
    title: winner.title,
    titleRevision: 1,
  });
  expect((await request(app).get('/api/v1/sessions')).body.data).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: original.id, titleRevision: 1 })]),
  );
  const missing = await request(app)
    .patch(`/api/v1/sessions/${randomUUID()}/title`)
    .send({ title: '不存在', expectedRevision: 0 });
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe('SESSION_NOT_FOUND');
  expect(provider).not.toHaveBeenCalled();
});
it.each([
  { title: ' ', expectedRevision: 0 },
  { title: 'x'.repeat(241), expectedRevision: 0 },
  { title: 'x', expectedRevision: -1 },
  { title: 'x', expectedRevision: 1.2 },
  { title: 'x', expectedRevision: '0' },
  { title: 'x', expectedRevision: 2147483647 },
  { title: 'x' },
  { title: 'x', expectedRevision: 0, status: 'READY' },
])('rejects invalid or extra fields before service: %j', async (body) => {
  const spy = vi.spyOn(service, 'renameTitle');
  const app = createApp({ sessions: service });
  const result = await request(app).patch(`/api/v1/sessions/${randomUUID()}/title`).send(body);
  expect(result.status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('shutdown rejects new rename and drains an already admitted title write', async () => {
  const sessions = new SessionRepository(db.db);
  const row = await sessions.create({
    id: randomUUID(),
    projectId,
    agentId,
    title: '改名前',
    cwd: '/tmp/fixture',
    status: 'CLOSED',
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = SessionRepository.prototype.renameTitle;
  const spy = vi
    .spyOn(SessionRepository.prototype, 'renameTitle')
    .mockImplementation(async function (this: SessionRepository<typeof db.db>, ...args) {
      await barrier;
      return original.apply(this, args);
    });
  try {
    const rename = service.renameTitle(row.id, { title: '已准入改名', expectedRevision: 0 });
    let stopped = false;
    const stop = service.shutdown().then(() => {
      stopped = true;
    });
    await expect(
      service.renameTitle(row.id, { title: '禁止新改名', expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: 'SESSION_SERVICE_STOPPING' });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
    release();
    await expect(rename).resolves.toMatchObject({
      title: '已准入改名',
      titleRevision: 1,
      status: 'CLOSED',
    });
    await stop;
    expect(stopped).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  } finally {
    release();
    spy.mockRestore();
  }
});
