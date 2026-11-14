import { randomUUID } from 'node:crypto';
import request from 'supertest';
import pino from 'pino';
import { AuthService } from '../auth/auth-service.js';
import { logRedaction } from '../log-redaction.js';
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
  ApiTokenRepository,
  LocalAuthRepository,
} from '@agenthub/db';
import { SessionService } from './session-service.js';
import type { AgentService } from '../agents/agent-service.js';
import { createApp } from '../app.js';
let db: Awaited<ReturnType<typeof createPgliteDatabase>>;
let service: SessionService;
let projectId: string, agentId: string;
const provider = vi.fn(() => {
  throw new Error('search must not call Agent');
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

async function fixture() {
  const session = await new SessionRepository(db.db).create({
    id: randomUUID(),
    projectId,
    agentId,
    title: '搜索 fixture',
    cwd: '/tmp/fixture',
    status: 'CLOSED',
  });
  const logs: string[] = [];
  const auth = new AuthService(
    new ApiTokenRepository(db.db),
    new LocalAuthRepository(db.db),
    'token',
    'search-test-token',
  );
  const app = createApp({
    sessions: service,
    auth,
    logger: pino(
      {},
      {
        write: (line) => {
          logs.push(line);
        },
      },
    ),
  });
  const url = `/api/v1/sessions/${session.id}/messages/search`;
  const search = (body: unknown) =>
    request(app)
      .post(url)
      .set('authorization', 'Bearer search-test-token')
      .send(body as object);
  return { session, logs, app, url, search };
}

it('requires authentication, validates strict private body and returns 404 without launching Agent', async () => {
  const { app, url, search } = await fixture();
  expect((await request(app).post(url).send({ query: 'private needle' })).status).toBe(401);
  for (const body of [
    {},
    { query: '' },
    { query: ' '.repeat(3) },
    { query: 'x'.repeat(201) },
    { query: 'x', limit: 20 },
    { query: 'x', beforeSequence: 2 },
    { query: 'x', upperSequence: -1 },
    { query: 'x', upperSequence: 1.5 },
    { query: 'x', upperSequence: '2' },
    { query: 'x', upperSequence: 2, beforeSequence: 0 },
    { query: 'x', upperSequence: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    expect((await search(body)).status).toBe(400);
  }
  expect(
    (
      await request(app)
        .post(`/api/v1/sessions/${randomUUID()}/messages/search`)
        .set('authorization', 'Bearer search-test-token')
        .send({ query: 'x' })
    ).status,
  ).toBe(404);
  expect(provider).not.toHaveBeenCalled();
});

it('searches literal saved USER/ASSISTANT text only, bounds DTO and preserves session state', async () => {
  const { session, search } = await fixture();
  const agentRepo = new AgentRepository(db.db);
  const agent = (await agentRepo.get(agentId))!;
  const disabled = await agentRepo.compareAndSetAvailability(agentId, false, agent.enabledRevision);
  expect(disabled?.enabled).toBe(false);
  expect(session.status).toBe('CLOSED');
  const repo = new MessageRepository(db.db);
  for (const role of ['USER', 'ASSISTANT', 'TOOL', 'SYSTEM'] as const) {
    await repo.append({
      sessionId: session.id,
      role,
      kind: 'TEXT',
      text: `${'前'.repeat(500)} <img> 100%_ 中文 Needle ${'后'.repeat(500)}`,
      contentJson: { secret: 'not-exported' },
    });
  }
  const other = await fixture();
  await repo.append({
    sessionId: other.session.id,
    role: 'USER',
    kind: 'TEXT',
    text: '100%_ 中文 Needle CROSS_SESSION_SECRET',
  });
  const response = await search({ query: ' 100%_ 中文 needle ' });
  expect(response.status).toBe(200);
  expect(response.body.data.hits).toHaveLength(2);
  for (const hit of response.body.data.hits) {
    expect(Object.keys(hit).sort()).toEqual(
      ['id', 'sessionId', 'role', 'createdAt', 'sequence', 'snippet'].sort(),
    );
    expect(hit.sessionId).toBe(session.id);
    expect(hit.snippet.length).toBeLessThanOrEqual(400);
    expect(hit.snippet).toContain('100%_ 中文 Needle');
  }
  expect(JSON.stringify(response.body)).not.toContain('not-exported');
  expect(JSON.stringify(response.body)).not.toContain('CROSS_SESSION_SECRET');
  expect(await new SessionRepository(db.db).get(session.id)).toEqual(session);
  expect(await new RunRepository(db.db).list(session.id)).toEqual([]);
  expect(provider).not.toHaveBeenCalled();
});

it('returns bounded progressing windows, fixed upper bound and no lost matches', async () => {
  const { session, search } = await fixture();
  const repo = new MessageRepository(db.db);
  for (let i = 0; i < 105; i++)
    await repo.append({
      sessionId: session.id,
      role: 'USER',
      kind: 'TEXT',
      text: i < 4 ? 'needle' : 'no match',
    });
  const first = await search({ query: 'needle' });
  expect(first.status).toBe(200);
  expect(first.body.data).toMatchObject({
    upperSequence: 105,
    scannedCount: 100,
    exhausted: false,
    hits: [],
    nextBeforeSequence: 6,
  });
  await repo.append({ sessionId: session.id, role: 'USER', kind: 'TEXT', text: 'needle new' });
  const second = await search({ query: 'needle', upperSequence: 105, beforeSequence: 6 });
  expect(second.body.data.exhausted).toBe(true);
  expect(second.body.data.hits.map((hit: { sequence: number }) => hit.sequence)).toEqual([
    4, 3, 2, 1,
  ]);
  for (let i = 0; i < 25; i++)
    await repo.append({ sessionId: session.id, role: 'ASSISTANT', kind: 'TEXT', text: 'crowded' });
  const page = await search({ query: 'crowded' });
  expect(page.body.data.hits).toHaveLength(20);
  const tail = await search({
    query: 'crowded',
    upperSequence: page.body.data.upperSequence,
    beforeSequence: page.body.data.nextBeforeSequence,
  });
  expect(tail.body.data.hits).toHaveLength(5);
});

it('does not expose query in access/error logs or nested database errors', async () => {
  const { search, logs, app, url } = await fixture();
  const secret = 'PRIVATE_SEARCH_MARKER_9c3';
  expect((await search({ query: secret })).status).toBe(200);
  const failure = vi
    .spyOn(MessageRepository.prototype, 'searchTextWindow')
    .mockRejectedValueOnce(new Error(`SQL params ${secret}`, { cause: new Error(secret) }));
  try {
    const response = await search({ query: secret });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('SESSION_MESSAGE_SEARCH_FAILED');
    expect(JSON.stringify(response.body)).not.toContain(secret);
  } finally {
    failure.mockRestore();
  }
  const malformed = await request(app)
    .post(url)
    .set('authorization', 'Bearer search-test-token')
    .set('content-type', 'application/json')
    .send(`{"query":"${secret}",broken`);
  expect(malformed.status).toBe(400);
  expect(JSON.stringify(malformed.body)).not.toContain(secret);
  const invalid = await search({ query: secret, [secret]: true });
  expect(invalid.status).toBe(400);
  expect(JSON.stringify(invalid.body)).not.toContain(secret);
  const invalidId = await request(app)
    .post('/api/v1/sessions/not-a-uuid/messages/search')
    .set('content-type', 'application/json')
    .send(`{"query":"${secret}",broken`);
  expect(invalidId.status).toBe(400);
  expect(JSON.stringify(invalidId.body)).not.toContain(secret);
  for (const mixedUrl of [
    url.replace('/search', '/SEARCH'),
    url.replace('/api/v1/sessions/', '/API/v1/SeSsIoNs/'),
  ]) {
    const mixedMalformed = await request(app)
      .post(mixedUrl)
      .set('content-type', 'application/json')
      .send(`{"query":"${secret}",broken`);
    expect.soft(mixedMalformed.status).toBe(400);
    expect.soft(JSON.stringify(mixedMalformed.body)).not.toContain(secret);
    const mixedInvalid = await request(app)
      .post(mixedUrl)
      .set('authorization', 'Bearer search-test-token')
      .send({ query: secret, [secret]: true });
    expect.soft(mixedInvalid.status).toBe(400);
    expect.soft(JSON.stringify(mixedInvalid.body)).not.toContain(secret);
  }
  expect(logs.join('')).toContain('request completed');
  expect(logs.join('')).toContain('request failed');
  expect(logs.join('')).not.toContain(secret);
  const explicit: string[] = [];
  pino(
    { redact: logRedaction },
    {
      write: (line) => {
        explicit.push(line);
      },
    },
  ).error(
    { req: { body: { query: secret } }, request: { body: { query: secret } } },
    'body fixture',
  );
  expect(explicit.join('')).not.toContain(secret);
  expect(explicit.join('')).toContain('[REDACTED]');
});
