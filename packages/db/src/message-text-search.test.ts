import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import {
  AgentRepository,
  ExecutionTargetRepository,
  MessageRepository,
  ProjectRepository,
  SessionRepository,
} from './repositories.js';
import { messages } from './schema.js';
let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
let projectId: string;
let agentId: string;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
  const target = await new ExecutionTargetRepository(database.db).create({
    id: randomUUID(),
    name: 'search fixture',
    kind: 'LOCAL_HOST',
    hostname: 'fixture',
    os: 'linux',
    arch: 'x64',
    status: 'READY',
  });
  const agent = await new AgentRepository(database.db).create({
    id: randomUUID(),
    targetId: target.id,
    name: 'fixture',
    agentKind: 'CUSTOM_ACP',
    adapterKind: 'ACP_STDIO',
    executable: '/fixture/never-executed',
    status: 'READY',
  });
  const project = await new ProjectRepository(database.db).create({
    id: randomUUID(),
    targetId: target.id,
    name: 'fixture',
    rootPath: '/tmp/fixture',
    realRootPath: '/tmp/fixture',
    repoKind: 'NONE',
    status: 'ACTIVE',
  });
  projectId = project.id;
  agentId = agent.id;
});
afterAll(async () => {
  await database.close();
});
async function fixture(rows: Array<{ text: string | null; role?: string }>) {
  const session = await new SessionRepository(database.db).create({
    id: randomUUID(),
    projectId,
    agentId,
    title: 'fixture',
    cwd: '/tmp/fixture',
    status: 'READY',
  });
  if (rows.length)
    await database.db.insert(messages).values(
      rows.map((row, index) => ({
        id: randomUUID(),
        sessionId: session.id,
        role: row.role ?? 'USER',
        kind: 'TEXT',
        text: row.text,
        sequence: index + 1,
        contentJson: { secret: 'must-not-return' },
      })),
    );
  return { sessionId: session.id, repository: new MessageRepository(database.db) };
}
it('Chinese, case and HTML are saved literal text; wildcard/regex/SQL-like input is not interpreted', async () => {
  const f = await fixture([
    { text: '你好 WORLD <b>原文</b> %_ [x]' },
    { text: '你好 world plain' },
    { text: '你好 WORLD', role: 'TOOL' },
    { text: '你好 WORLD', role: 'SYSTEM' },
    { text: null, role: 'ASSISTANT' },
  ]);
  await fixture([{ text: '你好 WORLD other-session' }]);
  for (const query of ['你好', ' world ']) {
    const page = await f.repository.searchTextWindow(f.sessionId, { query });
    expect(page.hits.map((hit) => hit.sequence)).toEqual([2, 1]);
    expect(page.hits.every((hit) => hit.sessionId === f.sessionId)).toBe(true);
    expect(page.hits[0]?.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(page.hits[0]!).sort()).toEqual([
      'createdAt',
      'id',
      'role',
      'sequence',
      'sessionId',
      'snippet',
    ]);
  }
  for (const query of ['%_', '<b>原文</b>', '[x]']) {
    const page = await f.repository.searchTextWindow(f.sessionId, { query });
    expect(page.hits.map((hit) => hit.sequence)).toEqual([1]);
    expect(page.hits[0]?.snippet).toContain(query);
  }
  expect(
    (await f.repository.searchTextWindow(f.sessionId, { query: "x' OR 1=1 --" })).hits,
  ).toEqual([]);
});
it('raw-message window precedes role filtering; zero hits still has an earlier scan cursor', async () => {
  const f = await fixture([
    { text: 'needle', role: 'ASSISTANT' },
    ...Array.from({ length: 100 }, () => ({ text: 'needle', role: 'TOOL' })),
  ]);
  const first = await f.repository.searchTextWindow(f.sessionId, { query: 'needle' });
  expect(first).toMatchObject({
    hits: [],
    upperSequence: 101,
    scannedCount: 100,
    nextBeforeSequence: 2,
    exhausted: false,
  });
  const next = await f.repository.searchTextWindow(f.sessionId, {
    query: 'needle',
    upperSequence: first.upperSequence,
    beforeSequence: first.nextBeforeSequence!,
  });
  expect(next.hits.map((hit) => hit.sequence)).toEqual([1]);
  expect(next).toMatchObject({ scannedCount: 1, exhausted: true, nextBeforeSequence: null });
});
it('more than 20 hits advances only through the twentieth hit; fixed upper bound excludes later appended messages', async () => {
  const f = await fixture(
    Array.from({ length: 45 }, (_, index) => ({
      text: `needle ${index + 1}`,
      role: index % 2 ? 'ASSISTANT' : 'USER',
    })),
  );
  const first = await f.repository.searchTextWindow(f.sessionId, { query: 'needle' });
  expect(first.hits.map((hit) => hit.sequence)).toEqual(
    Array.from({ length: 20 }, (_, index) => 45 - index),
  );
  expect(first).toMatchObject({
    upperSequence: 45,
    nextBeforeSequence: 26,
    scannedCount: 20,
    exhausted: false,
  });
  await f.repository.append({
    sessionId: f.sessionId,
    role: 'ASSISTANT',
    kind: 'TEXT',
    text: 'needle newly appended',
  });
  const all = [...first.hits];
  let cursor = first.nextBeforeSequence;
  while (cursor !== null) {
    const page = await f.repository.searchTextWindow(f.sessionId, {
      query: 'needle',
      upperSequence: first.upperSequence,
      beforeSequence: cursor,
    });
    all.push(...page.hits);
    cursor = page.nextBeforeSequence;
  }
  expect(all.map((hit) => hit.sequence)).toEqual(
    Array.from({ length: 45 }, (_, index) => 45 - index),
  );
  expect(new Set(all.map((hit) => hit.id)).size).toBe(45);
  expect(
    (await f.repository.searchTextWindow(f.sessionId, { query: 'needle' })).upperSequence,
  ).toBe(46);
});
it('sparse mixed windows do not omit or repeat hits across scan boundaries', async () => {
  const rows = Array.from({ length: 245 }, (_, index) => ({
    text: index % 2 === 0 ? 'needle' : 'different',
    role: (index + 1) % 3 === 0 ? 'SYSTEM' : 'USER',
  }));
  const f = await fixture(rows);
  const found: number[] = [];
  let upperSequence: number | undefined;
  let beforeSequence: number | undefined;
  for (let pages = 0; pages < 30; pages += 1) {
    const page = await f.repository.searchTextWindow(f.sessionId, {
      query: 'needle',
      upperSequence,
      beforeSequence,
    });
    expect(page.scannedCount).toBeLessThanOrEqual(100);
    expect(page.hits.length).toBeLessThanOrEqual(20);
    found.push(...page.hits.map((hit) => hit.sequence));
    upperSequence = page.upperSequence;
    if (page.exhausted) {
      expect(page.nextBeforeSequence).toBeNull();
      break;
    }
    expect(page.nextBeforeSequence).not.toBeNull();
    beforeSequence = page.nextBeforeSequence!;
  }
  expect(found).toEqual(
    rows
      .map((row, index) => ({ ...row, sequence: index + 1 }))
      .filter((row) => row.role === 'USER' && row.text === 'needle')
      .map((row) => row.sequence)
      .reverse(),
  );
});
it('empty and exact-100 windows are exhausted only after a real end-of-history observation', async () => {
  const empty = await fixture([]);
  expect(await empty.repository.searchTextWindow(empty.sessionId, { query: 'needle' })).toEqual({
    hits: [],
    upperSequence: 0,
    nextBeforeSequence: null,
    scannedCount: 0,
    exhausted: true,
  });
  const hundred = await fixture(Array.from({ length: 100 }, () => ({ text: 'different' })));
  expect(
    await hundred.repository.searchTextWindow(hundred.sessionId, { query: 'needle' }),
  ).toMatchObject({
    hits: [],
    upperSequence: 100,
    scannedCount: 100,
    exhausted: true,
    nextBeforeSequence: null,
  });
});
it('database creates a bounded Unicode excerpt around a late match, never returning full text or contentJson', async () => {
  const text = '😀'.repeat(5_000) + '中文Needle' + '后'.repeat(5_000);
  const f = await fixture([{ text, role: 'ASSISTANT' }]);
  const result = await f.repository.searchTextWindow(f.sessionId, { query: 'needle' });
  expect(result.hits[0]?.snippet).toContain('中文Needle');
  expect(Array.from(result.hits[0]!.snippet).length).toBeLessThanOrEqual(400);
  expect(JSON.stringify(result)).not.toContain('must-not-return');
  expect(result.hits[0]).not.toHaveProperty('text');
  expect(result.hits[0]).not.toHaveProperty('contentJson');
});
it('invalid query/ranges are rejected; oversized before is safely intersected with the fixed upper bound', async () => {
  const f = await fixture([{ text: 'needle' }]);
  const invalid = [
    { query: '' },
    { query: '   ' },
    { query: 'x'.repeat(201) },
    { query: 'needle', upperSequence: -1 },
    { query: 'needle', upperSequence: Number.MAX_SAFE_INTEGER + 1 },
    { query: 'needle', upperSequence: NaN },
    { query: 'needle', upperSequence: 1.5 },
    { query: 'needle', beforeSequence: 1 },
    { query: 'needle', upperSequence: 1, beforeSequence: 0 },
    { query: 'needle', upperSequence: 1, beforeSequence: Infinity },
  ];
  for (const options of invalid)
    await expect(f.repository.searchTextWindow(f.sessionId, options)).rejects.toMatchObject({
      code: 'MESSAGE_SEARCH_INPUT_INVALID',
    });
  expect(
    (
      await f.repository.searchTextWindow(f.sessionId, {
        query: 'needle',
        upperSequence: 1,
        beforeSequence: Number.MAX_SAFE_INTEGER,
      })
    ).hits,
  ).toHaveLength(1);
});

it('exactly 20 hits scans the rest of the window; the extra probe is not lost', async () => {
  const f = await fixture([
    { text: 'needle oldest' },
    ...Array.from({ length: 80 }, () => ({ text: 'different' })),
    ...Array.from({ length: 20 }, () => ({ text: 'needle newest' })),
  ]);
  const first = await f.repository.searchTextWindow(f.sessionId, { query: 'needle' });
  expect(first.hits).toHaveLength(20);
  expect(first).toMatchObject({
    scannedCount: 100,
    nextBeforeSequence: 2,
    upperSequence: 101,
    exhausted: false,
  });
  const last = await f.repository.searchTextWindow(f.sessionId, {
    query: 'needle',
    upperSequence: first.upperSequence,
    beforeSequence: first.nextBeforeSequence!,
  });
  expect(last.hits.map((hit) => hit.sequence)).toEqual([1]);
  expect(last.exhausted).toBe(true);
});
