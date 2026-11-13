import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import {
  GIT_COORDINATION_DOMAIN_SETTING_KEY as key,
  getOrCreateGitCoordinationDomain,
} from './git-coordination-domain.js';
import { ExecutionTargetRepository, ProjectRepository } from './repositories.js';
import { appSettings, gitCommitOperations, gitWriteClaims } from './schema.js';

let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
let projectId: string;
let targetId: string;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
  targetId = (
    await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: 'domain',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    })
  ).id;
  projectId = (
    await new ProjectRepository(database.db).create({
      id: randomUUID(),
      targetId,
      name: 'domain',
      rootPath: '/tmp/domain',
      realRootPath: '/tmp/domain',
      repoKind: 'GIT',
      status: 'ACTIVE',
    })
  ).id;
});
afterAll(async () => database?.close());
beforeEach(async () => {
  await database.db.delete(gitWriteClaims);
  await database.db.delete(gitCommitOperations);
  await database.db.delete(appSettings).where(eq(appSettings.key, key));
});
async function operation(overrides: Partial<typeof gitCommitOperations.$inferInsert> = {}) {
  const [row] = await database.db
    .insert(gitCommitOperations)
    .values({
      ownerScope: 'local-trusted',
      operationId: randomUUID(),
      projectId,
      targetId,
      requestHash: 'a'.repeat(64),
      payloadJson: {},
      executionDeviceId: 'old-device',
      repositoryKey: 'old-key',
      canonicalCommonDir: '/tmp/domain/.git',
      worktreeIdentity: '/tmp/domain',
      phase: 'UNKNOWN',
      dispatchToken: randomUUID(),
      workerId: 'test',
      ...overrides,
    })
    .returning();
  return row!;
}
it('concurrent initializers return one persisted winner without per-boot identities', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => getOrCreateGitCoordinationDomain(database.db)),
  );
  for (const result of results) expect(result).toEqual(results[0]);
  expect(results[0]).toEqual({
    id: expect.any(String),
    executionDeviceId: `db-domain:${results[0]!.id}`,
    repositoryKey: `git-domain:${results[0]!.id}`,
  });
  const rows = await database.db.select().from(appSettings).where(eq(appSettings.key, key));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.valueJson).toEqual({ version: 1, id: results[0]!.id });
});
it.each([
  {},
  { version: 2, id: randomUUID() },
  { version: 1, id: 'invalid' },
  { version: 1, id: randomUUID().toUpperCase() },
  { version: 1, id: randomUUID(), extra: true },
])('corrupt setting fails closed without repair: %j', async (valueJson) => {
  await database.db.insert(appSettings).values({ key, valueJson });
  await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
    code: 'GIT_DOMAIN_INVALID',
  });
  expect(
    (await database.db.select().from(appSettings).where(eq(appSettings.key, key)))[0]!.valueJson,
  ).toEqual(valueJson);
});
it.each(['UNKNOWN', 'COMMAND_SUCCEEDED'])(
  'missing domain with %s history is not silently initialized',
  async (phase) => {
    await operation({ phase });
    await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
      code: 'GIT_DOMAIN_MISSING',
    });
    expect(await database.db.select().from(appSettings).where(eq(appSettings.key, key))).toEqual(
      [],
    );
  },
);
it.each(['RECEIVED', 'DISPATCHED', 'UNKNOWN'])(
  'mismatched active %s operation is not unlocked',
  async (phase) => {
    const domain = await getOrCreateGitCoordinationDomain(database.db);
    await operation({ phase, repositoryKey: domain.repositoryKey });
    await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
      code: 'GIT_DOMAIN_MISMATCH',
    });
  },
);
it('matches both domain identifiers, rejects changed domain id and preserves UNKNOWN claim', async () => {
  const domain = await getOrCreateGitCoordinationDomain(database.db);
  const row = await operation({
    executionDeviceId: domain.executionDeviceId,
    repositoryKey: domain.repositoryKey,
  });
  await database.db.insert(gitWriteClaims).values({
    repositoryKey: domain.repositoryKey,
    ownerScope: row.ownerScope,
    operationId: row.operationId,
    dispatchToken: row.dispatchToken,
    workerId: row.workerId,
    phase: 'UNKNOWN',
  });
  expect(await getOrCreateGitCoordinationDomain(database.db)).toEqual(domain);
  await database.db
    .update(appSettings)
    .set({ valueJson: { version: 1, id: randomUUID() } })
    .where(eq(appSettings.key, key));
  await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
    code: 'GIT_DOMAIN_MISMATCH',
  });
  expect(await database.db.select().from(gitWriteClaims)).toHaveLength(1);
});
it('claim with mismatched key fails even if associated operation is terminal', async () => {
  await getOrCreateGitCoordinationDomain(database.db);
  const row = await operation({ phase: 'COMMAND_SUCCEEDED' });
  await database.db.insert(gitWriteClaims).values({
    repositoryKey: 'old-key',
    ownerScope: row.ownerScope,
    operationId: row.operationId,
    dispatchToken: row.dispatchToken,
    workerId: row.workerId,
    phase: 'UNKNOWN',
  });
  await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
    code: 'GIT_DOMAIN_MISMATCH',
  });
});
it('terminal history without claims does not block an existing valid domain', async () => {
  const domain = await getOrCreateGitCoordinationDomain(database.db);
  await operation({ phase: 'REJECTED_PREWRITE' });
  expect(await getOrCreateGitCoordinationDomain(database.db)).toEqual(domain);
});
it('file-backed database retains exact domain over close and reopen', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-git-domain-'));
  let fileDb: Awaited<ReturnType<typeof createPgliteDatabase>> | undefined;
  try {
    fileDb = await createPgliteDatabase({ dataDir: join(temp, 'db') });
    const domain = await getOrCreateGitCoordinationDomain(fileDb.db);
    await fileDb.close();
    fileDb = undefined;
    fileDb = await createPgliteDatabase({ dataDir: join(temp, 'db') });
    expect(await getOrCreateGitCoordinationDomain(fileDb.db)).toEqual(domain);
  } finally {
    await fileDb?.close();
    await rm(temp, { recursive: true, force: true });
  }
});

it('matching claim key cannot hide a mismatched terminal operation domain', async () => {
  const domain = await getOrCreateGitCoordinationDomain(database.db);
  const row = await operation({ phase: 'COMMAND_SUCCEEDED', repositoryKey: domain.repositoryKey });
  await database.db.insert(gitWriteClaims).values({
    repositoryKey: domain.repositoryKey,
    ownerScope: row.ownerScope,
    operationId: row.operationId,
    dispatchToken: row.dispatchToken,
    workerId: row.workerId,
    phase: 'UNKNOWN',
  });
  await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
    code: 'GIT_DOMAIN_MISMATCH',
  });
});

it.each(['RECEIVED', 'DISPATCHED', 'UNKNOWN'])(
  'matching %s operation without its claim fails closed',
  async (phase) => {
    const domain = await getOrCreateGitCoordinationDomain(database.db);
    await operation({
      phase,
      repositoryKey: domain.repositoryKey,
      executionDeviceId: domain.executionDeviceId,
    });
    await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
      code: 'GIT_DOMAIN_MISMATCH',
    });
    expect(await database.db.select().from(gitWriteClaims)).toEqual([]);
  },
);
it.each(['dispatchToken', 'workerId', 'phase', 'terminal'])(
  'claim integrity mismatch %s is never repaired or released',
  async (field) => {
    const domain = await getOrCreateGitCoordinationDomain(database.db);
    const row = await operation({
      repositoryKey: domain.repositoryKey,
      executionDeviceId: domain.executionDeviceId,
    });
    const claim = {
      repositoryKey: domain.repositoryKey,
      ownerScope: row.ownerScope,
      operationId: row.operationId,
      dispatchToken: row.dispatchToken,
      workerId: row.workerId,
      phase: row.phase,
    };
    if (field === 'dispatchToken') claim.dispatchToken = randomUUID();
    if (field === 'workerId') claim.workerId = 'different-worker';
    if (field === 'phase') claim.phase = 'DISPATCHED';
    if (field === 'terminal')
      await database.db
        .update(gitCommitOperations)
        .set({ phase: 'COMMAND_SUCCEEDED' })
        .where(eq(gitCommitOperations.operationId, row.operationId));
    await database.db.insert(gitWriteClaims).values(claim);
    await expect(getOrCreateGitCoordinationDomain(database.db)).rejects.toMatchObject({
      code: 'GIT_DOMAIN_MISMATCH',
    });
    expect(await database.db.select().from(gitWriteClaims)).toHaveLength(1);
  },
);
