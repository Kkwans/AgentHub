import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import { AgentRepository, ExecutionTargetRepository } from './repositories.js';
import { createLegacyAgent } from './migration-test-helpers.js';

it('0015 preserves old enabled values; CAS is atomic, scoped and durable without mutating health/defaults', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agent-availability-'));
  const migrations = resolve(import.meta.dirname, '../drizzle');
  const old = join(temp, 'old');
  await mkdir(join(old, 'meta'), { recursive: true });
  const journal = JSON.parse(await readFile(join(migrations, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 15);
  await writeFile(join(old, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await cp(join(migrations, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`));
  const dataDir = join(temp, 'db');
  let database: Awaited<ReturnType<typeof createPgliteDatabase>> | undefined;
  try {
    database = await createPgliteDatabase({ dataDir, migrationsFolder: old });
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: 'fixture',
      kind: 'LOCAL_HOST',
      hostname: 'fixture',
      os: 'linux',
      arch: 'x64',
      status: 'READY',
    });
    const first = await createLegacyAgent(database.db, {
      id: randomUUID(),
      targetId: target.id,
      name: 'enabled',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
      enabled: true,
    });
    const second = await createLegacyAgent(database.db, {
      id: randomUUID(),
      targetId: target.id,
      name: 'disabled',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'BROKEN',
      enabled: false,
    });
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    const agents = new AgentRepository(database.db);
    const fresh = await agents.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'fresh',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    expect(fresh).toMatchObject({ enabled: true, enabledRevision: 0 });
    expect(await agents.get(first.id)).toEqual({ ...first, enabledRevision: 0 });
    expect(await agents.get(second.id)).toEqual({ ...second, enabledRevision: 0 });
    const winners = await Promise.all([
      agents.compareAndSetAvailability(first.id, false, 0),
      agents.compareAndSetAvailability(first.id, true, 0),
    ]);
    expect(winners.filter(Boolean)).toHaveLength(1);
    const committed = winners.find(Boolean)!;
    expect(committed.enabledRevision).toBe(1);
    const next = await agents.compareAndSetAvailability(first.id, committed.enabled, 1);
    expect(next).toMatchObject({ enabled: committed.enabled, enabledRevision: 2 });
    expect(committed.enabledRevision).toBe(1); // Exact previous commit snapshot is not a reread.
    const {
      enabled: _enabled,
      enabledRevision: _revision,
      updatedAt: _updated,
      ...unchanged
    } = next!;
    void _enabled;
    void _revision;
    void _updated;
    const { enabled: _oldEnabled, updatedAt: _oldUpdated, ...oldUnchanged } = first;
    void _oldEnabled;
    void _oldUpdated;
    expect(unchanged).toEqual(oldUnchanged);
    expect(await agents.compareAndSetAvailability(first.id, !committed.enabled, 0)).toBeUndefined();
    expect(await agents.compareAndSetAvailability(randomUUID(), false, 0)).toBeUndefined();
    expect(await agents.get(second.id)).toEqual({ ...second, enabledRevision: 0 });
    await agents.update(first.id, { defaultModel: 'model', defaultMode: 'mode' });
    await agents.updatePreflight(first.id, {
      status: 'READY',
      detectedVersion: '1.2.3',
      capabilitiesJson: { history: true },
    });
    expect(await agents.get(first.id)).toMatchObject({
      enabled: committed.enabled,
      enabledRevision: 2,
      defaultModel: 'model',
      defaultMode: 'mode',
    });
    // Runtime extra keys cannot bypass the typed public contracts.
    await expect(agents.update(first.id, { enabled: true } as never)).rejects.toMatchObject({
      code: 'AGENT_AVAILABILITY_PROTECTED',
    });
    await expect(agents.update(first.id, { enabledRevision: 0 } as never)).rejects.toMatchObject({
      code: 'AGENT_AVAILABILITY_PROTECTED',
    });
    await agents.updatePreflight(first.id, {
      status: 'BROKEN',
      enabled: !committed.enabled,
      enabledRevision: 50,
    } as never);
    expect(await agents.get(first.id)).toMatchObject({
      enabled: committed.enabled,
      enabledRevision: 2,
      status: 'BROKEN',
    });
    for (const revision of [-1, 0.5, NaN, Infinity, 2_147_483_647])
      await expect(
        agents.compareAndSetAvailability(first.id, false, revision),
      ).rejects.toMatchObject({ code: 'AGENT_AVAILABILITY_INPUT_INVALID' });
    await expect(
      agents.compareAndSetAvailability(first.id, 'false' as never, 2),
    ).rejects.toMatchObject({ code: 'AGENT_AVAILABILITY_INPUT_INVALID' });
    await database.db.execute(
      sql`update agents set enabled_revision=2147483646 where id=${first.id}`,
    );
    expect(await agents.compareAndSetAvailability(first.id, false, 2_147_483_646)).toMatchObject({
      enabled: false,
      enabledRevision: 2_147_483_647,
    });
    await expect(
      agents.compareAndSetAvailability(first.id, true, 2_147_483_647),
    ).rejects.toMatchObject({ code: 'AGENT_AVAILABILITY_INPUT_INVALID' });
    await expect(
      database.db.execute(sql`update agents set enabled_revision=-1 where id=${second.id}`),
    ).rejects.toThrow();
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    expect(await new AgentRepository(database.db).get(first.id)).toMatchObject({
      enabled: false,
      enabledRevision: 2_147_483_647,
      defaultModel: 'model',
      status: 'BROKEN',
    });
    expect(await new AgentRepository(database.db).get(second.id)).toEqual({
      ...second,
      enabledRevision: 0,
    });
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
