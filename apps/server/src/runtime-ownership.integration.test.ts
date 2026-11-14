import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ExecutionTargetRepository,
  ProjectRepository,
  AgentRepository,
  SessionRepository,
} from '@agenthub/db';
import { startServer, type RunningServer } from './index.js';
import { SessionService } from './sessions/session-service.js';
const active: RunningServer[] = [];
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of active.splice(0)) await server.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function config() {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-owner-server-'));
  roots.push(root);
  return {
    LOG_LEVEL: 'silent',
    AGENTHUB_HOST: '127.0.0.1',
    AGENTHUB_PORT: '0',
    AGENTHUB_AUTH_MODE: 'local_trusted',
    AGENTHUB_DATA_DIR: join(root, 'data'),
  };
}
it('second startup is rejected before recovery and healthy owner remains unchanged; orderly close permits restart', async () => {
  const env = await config();
  const first = await startServer(env);
  active.push(first);
  const db = first.database.db;
  const target = await new ExecutionTargetRepository(db).create({
    id: randomUUID(),
    name: 'isolated owner fixture',
    kind: 'LOCAL_HOST',
    hostname: 'fixture',
    os: 'linux',
    arch: 'x64',
    status: 'READY',
  });
  const project = await new ProjectRepository(db).create({
    id: randomUUID(),
    targetId: target.id,
    name: 'isolated project',
    rootPath: env.AGENTHUB_DATA_DIR,
    realRootPath: env.AGENTHUB_DATA_DIR,
    repoKind: 'NONE',
    status: 'ACTIVE',
  });
  const agent = await new AgentRepository(db).create({
    id: randomUUID(),
    targetId: target.id,
    name: 'never launched',
    agentKind: 'CUSTOM_ACP',
    adapterKind: 'ACP_STDIO',
    executable: '/bin/false',
    status: 'READY',
  });
  const sessions = new SessionRepository(db);
  const session = await sessions.create({
    id: randomUUID(),
    projectId: project.id,
    agentId: agent.id,
    title: 'must not be recovered by rejected startup',
    cwd: env.AGENTHUB_DATA_DIR,
    status: 'READY',
  });
  const before = await sessions.get(session.id);
  await expect(startServer(env)).rejects.toMatchObject({ code: 'RUNTIME_OWNERSHIP_HELD' });
  expect(await sessions.get(session.id)).toEqual(before);
  expect(first.server.listening).toBe(true);
  await first.close();
  active.splice(active.indexOf(first), 1);
  const next = await startServer(env);
  active.push(next);
  expect(next.server.listening).toBe(true);
}, 30000);
it('startup recovery failure cleans partial resources and releases ownership for a later startup', async () => {
  const env = await config();
  vi.spyOn(SessionService.prototype, 'recoverAfterRestart').mockRejectedValueOnce(
    new Error('isolated recovery failure'),
  );
  await expect(startServer(env)).rejects.toThrow('isolated recovery failure');
  const next = await startServer(env);
  active.push(next);
  expect(next.server.listening).toBe(true);
}, 30000);
it('unconfirmed session shutdown retains healthy database ownership and blocks replacement startup', async () => {
  const env = await config();
  const first = await startServer(env);
  const shutdown = vi
    .spyOn(SessionService.prototype, 'shutdown')
    .mockRejectedValueOnce(new Error('isolated unconfirmed provider cleanup'));
  try {
    await expect(first.close()).rejects.toThrow('Runtime shutdown failed');
    expect(first.server.listening).toBe(false);
    first.database.runtimeOwnership!.assertHeld();
    await expect(startServer(env)).rejects.toMatchObject({ code: 'RUNTIME_OWNERSHIP_HELD' });
    await expect(first.close()).rejects.toThrow('Runtime shutdown failed');
  } finally {
    shutdown.mockRestore();
    // This fixture has no provider handles. Explicitly release only its isolated DB.
    await first.database.close();
  }
}, 30000);
