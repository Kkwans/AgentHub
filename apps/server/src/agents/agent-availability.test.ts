import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { AgentRepository, createPgliteDatabase, ExecutionTargetRepository } from '@agenthub/db';
import { FakeAgentAdapter, ResourceCleanupUnconfirmedError } from '@agenthub/agent-core';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AgentService } from './agent-service.js';
import { createApp } from '../app.js';
let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
});
afterAll(async () => {
  await database.close();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(assertHeld = () => undefined) {
  const agents = new AgentRepository(database.db);
  const targets = new ExecutionTargetRepository(database.db);
  const target = await targets.create({
    id: randomUUID(),
    name: 'fixture',
    kind: 'LOCAL_HOST',
    hostname: 'fixture',
    os: 'linux',
    arch: 'x64',
    status: 'READY',
  });
  const agent = await agents.create({
    id: randomUUID(),
    targetId: target.id,
    name: 'fixture',
    agentKind: 'CUSTOM_ACP',
    adapterKind: 'ACP_STDIO',
    executable: '/fixture/not-executed',
    status: 'READY',
  });
  const adapter = new FakeAgentAdapter();
  const launch = vi.fn(async () => {
    throw new Error('No provider launch permitted');
  });
  const service = new AgentService(
    agents,
    targets,
    { launch },
    () => adapter,
    undefined,
    async () => ({}),
    assertHeld,
  );
  return { agents, target, agent, adapter, service, launch };
}
it('strict availability HTTP CAS preserves readiness/defaults and returns the committed version', async () => {
  const f = await fixture();
  const app = createApp({ agents: f.service });
  const responses = await Promise.all(
    [true, false].map((enabled) =>
      request(app)
        .patch(`/api/v1/agents/${f.agent.id}/availability`)
        .send({ enabled, expectedRevision: 0 }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const saved = await f.agents.get(f.agent.id);
  expect(saved).toMatchObject({ enabledRevision: 1, status: 'READY', defaultModel: null });
  expect(responses.find((r) => r.status === 200)?.body.data).toMatchObject({
    enabled: saved?.enabled,
    enabledRevision: 1,
  });
  for (const body of [
    { enabled: false },
    { enabled: 'false', expectedRevision: 1 },
    { enabled: false, expectedRevision: -1 },
    { enabled: false, expectedRevision: 2147483647 },
    { enabled: false, expectedRevision: 1, status: 'READY' },
  ])
    expect(
      (await request(app).patch(`/api/v1/agents/${f.agent.id}/availability`).send(body)).status,
    ).toBe(400);
  expect(
    (
      await request(app)
        .patch(`/api/v1/agents/${randomUUID()}/availability`)
        .send({ enabled: false, expectedRevision: 0 })
    ).status,
  ).toBe(404);
  expect(f.launch).not.toHaveBeenCalled();
});
it('disabled blocks runtime resolution, both preflight entrances and direct new-work admission without provider work', async () => {
  const f = await fixture();
  const preflight = vi.spyOn(f.adapter, 'preflight');
  const capabilities = vi.spyOn(f.adapter, 'getCapabilities');
  await f.service.setAvailability(f.agent.id, { enabled: false, expectedRevision: 0 });
  await expect(f.service.resolveRuntime(f.agent.id, '/tmp', f.target.id)).rejects.toMatchObject({
    code: 'AGENT_NOT_READY',
  });
  await expect(f.service.admitNewWork(f.agent.id)).rejects.toMatchObject({
    code: 'AGENT_DISABLED',
  });
  await expect(f.service.preflight(f.agent.id, { cwd: '/tmp' })).rejects.toMatchObject({
    code: 'AGENT_DISABLED',
  });
  const cwd = await realpath('/tmp');
  await expect(
    f.service.checkConnection(f.agent.id, f.target.id, {
      id: randomUUID(),
      targetId: f.target.id,
      status: 'ACTIVE',
      rootPath: cwd,
      realRootPath: cwd,
    }),
  ).rejects.toMatchObject({ code: 'AGENT_DISABLED' });
  expect(preflight).not.toHaveBeenCalled();
  expect(capabilities).not.toHaveBeenCalled();
  expect(await f.service.getProfile(f.agent.id, '/tmp')).toMatchObject({ id: f.agent.id });
  await f.service.setAvailability(f.agent.id, { enabled: true, expectedRevision: 1 });
  await expect(f.service.admitNewWork(f.agent.id)).resolves.toMatchObject({
    enabled: true,
    enabledRevision: 2,
  });
});
it('disable wins queued admission and queue does not retain a failed CAS', async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  const original = f.agents.compareAndSetAvailability.bind(f.agents);
  vi.spyOn(f.agents, 'compareAndSetAvailability').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const disable = f.service.setAvailability(f.agent.id, { enabled: false, expectedRevision: 0 });
  await entered.promise;
  const next = expect(f.service.admitNewWork(f.agent.id)).rejects.toMatchObject({
    code: 'AGENT_DISABLED',
  });
  release.resolve();
  await disable;
  await next;
  await expect(
    f.service.setAvailability(f.agent.id, { enabled: true, expectedRevision: 0 }),
  ).rejects.toMatchObject({ code: 'AGENT_AVAILABILITY_CONFLICT' });
  await expect(
    f.service.setAvailability(f.agent.id, { enabled: true, expectedRevision: 1 }),
  ).resolves.toMatchObject({ enabled: true });
});
it('admitted preflight continues outside the short lock while disable completes', async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  vi.spyOn(f.adapter, 'preflight').mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return { status: 'READY', checkedAt: new Date().toISOString(), checks: [] };
  });
  const check = f.service.preflight(f.agent.id, { cwd: '/tmp', smokeSession: false });
  await entered.promise;
  await expect(
    f.service.setAvailability(f.agent.id, { enabled: false, expectedRevision: 0 }),
  ).resolves.toMatchObject({ enabled: false });
  release.resolve();
  await check;
  expect(await f.agents.get(f.agent.id)).toMatchObject({
    enabled: false,
    enabledRevision: 1,
    status: 'READY',
  });
});
it('shutdown waits for availability DB work and rejects new direct service admission', async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  const original = f.agents.compareAndSetAvailability.bind(f.agents);
  vi.spyOn(f.agents, 'compareAndSetAvailability').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const writing = f.service.setAvailability(f.agent.id, { enabled: false, expectedRevision: 0 });
  await entered.promise;
  const queued = expect(f.service.admitNewWork(f.agent.id)).rejects.toMatchObject({
    code: 'AGENT_ADMISSION_STOPPING',
  });
  let stopped = false;
  const stop = f.service.shutdownConnectionChecks().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  await expect(f.service.admitNewWork(f.agent.id)).rejects.toMatchObject({
    code: 'AGENT_ADMISSION_STOPPING',
  });
  release.resolve();
  await writing;
  await queued;
  await stop;
});
it('ownership revoked during an awaited eligibility read cannot admit new work', async () => {
  let held = true;
  const f = await fixture(() => {
    if (!held) throw new Error('ownership revoked');
  });
  const entered = barrier();
  const release = barrier();
  const original = f.agents.get.bind(f.agents);
  vi.spyOn(f.agents, 'get').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const admitted = expect(f.service.admitNewWork(f.agent.id)).rejects.toThrow('ownership revoked');
  await entered.promise;
  held = false;
  release.resolve();
  await admitted;
});
it('reenabling preserves saved health/capabilities: create still requires READY while preflight may recheck unhealthy Agents', async () => {
  const f = await fixture();
  await f.agents.update(f.agent.id, { status: 'BROKEN', capabilitiesJson: { fixture: true } });
  await f.service.setAvailability(f.agent.id, { enabled: false, expectedRevision: 0 });
  await f.service.setAvailability(f.agent.id, { enabled: true, expectedRevision: 1 });
  expect(await f.agents.get(f.agent.id)).toMatchObject({
    enabled: true,
    status: 'BROKEN',
    capabilitiesJson: { fixture: true },
  });
  await expect(f.service.resolveRuntime(f.agent.id, '/tmp', f.target.id)).rejects.toMatchObject({
    code: 'AGENT_NOT_READY',
  });
  const probe = vi
    .spyOn(f.adapter, 'preflight')
    .mockResolvedValue({ status: 'READY', checkedAt: new Date().toISOString(), checks: [] });
  await f.service.preflight(f.agent.id, { cwd: '/tmp', smokeSession: false });
  expect(probe).toHaveBeenCalledTimes(1);
});

it('disable then enable cannot clear the unconfirmed preflight cleanup fence', async () => {
  const f = await fixture();
  const probe = vi
    .spyOn(f.adapter, 'preflight')
    .mockRejectedValueOnce(new ResourceCleanupUnconfirmedError());
  await expect(f.service.preflight(f.agent.id, { cwd: '/tmp' })).rejects.toBeInstanceOf(
    ResourceCleanupUnconfirmedError,
  );
  await f.service.setAvailability(f.agent.id, { enabled: false, expectedRevision: 0 });
  await f.service.setAvailability(f.agent.id, { enabled: true, expectedRevision: 1 });
  await expect(f.service.preflight(f.agent.id, { cwd: '/tmp' })).rejects.toMatchObject({
    code: 'AGENT_CHECK_UNAVAILABLE',
  });
  expect(probe).toHaveBeenCalledTimes(1);
  await expect(f.service.shutdownConnectionChecks()).rejects.toMatchObject({
    code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
  });
});

it('a timed-out availability mutation drain stays rejected after the late DB write settles', async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  const original = f.agents.compareAndSetAvailability.bind(f.agents);
  vi.spyOn(f.agents, 'compareAndSetAvailability').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const mutation = f.service.setAvailability(f.agent.id, { enabled: false, expectedRevision: 0 });
  await entered.promise;
  vi.useFakeTimers();
  const shutdown = f.service.shutdownConnectionChecks();
  const observed = expect(shutdown).rejects.toMatchObject({
    code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
  });
  await vi.advanceTimersByTimeAsync(5001);
  await observed;
  expect(f.service.shutdownConnectionChecks()).toBe(shutdown);
  vi.useRealTimers();
  release.resolve();
  await mutation;
  await expect(f.service.shutdownConnectionChecks()).rejects.toMatchObject({
    code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
  });
  await expect(
    f.service.setAvailability(f.agent.id, { enabled: true, expectedRevision: 1 }),
  ).rejects.toMatchObject({ code: 'AGENT_ADMISSION_STOPPING' });
});
