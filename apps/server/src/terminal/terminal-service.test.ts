import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPgliteDatabase, executionTargets, ProjectRepository, projects } from '@agenthub/db';
import type { IPty, IPtyForkOptions } from 'node-pty';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TerminalService } from './terminal-service.js';

describe('Terminal capability 与 PTY 生命周期', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let projectId: string;
  let root: string;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    root = await mkdtemp(join(tmpdir(), 'agenthub-terminal-'));
    const targetId = randomUUID();
    projectId = randomUUID();
    await database.db.insert(executionTargets).values({
      id: targetId,
      name: '测试宿主机',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await database.db.insert(projects).values({
      id: projectId,
      name: 'Terminal Fixture',
      targetId,
      rootPath: root,
      realRootPath: root,
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
  });

  afterAll(async () => database.close());

  it('native binding 缺失时 capability=false 且不使用 shell fallback', async () => {
    const service = new TerminalService(
      new ProjectRepository(database.db),
      { publish: () => undefined },
      async () => {
        throw new Error('pty.node missing');
      },
    );
    expect(await service.diagnose()).toMatchObject({
      available: false,
      code: 'PTY_NATIVE_BINDING_UNAVAILABLE',
    });
    await expect(service.open({ projectId })).rejects.toMatchObject({
      code: 'PTY_NATIVE_BINDING_UNAVAILABLE',
    });
  });

  it('shutdown 同步拒绝新 open，等待 native binding 的旧请求也不能晚到 spawn', async () => {
    let finishLoad!: () => void;
    let loadCount = 0;
    let spawnCount = 0;
    const loading = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    const service = new TerminalService(
      new ProjectRepository(database.db),
      { publish: () => undefined },
      async () => {
        loadCount++;
        await loading;
        return {
          spawn: () => {
            spawnCount++;
            return new FakePty() as unknown as IPty;
          },
        } as never;
      },
    );
    const opening = service.open({ projectId, shell: '/bin/sh' });
    const rejected = expect(opening).rejects.toMatchObject({ code: 'TERMINAL_SERVICE_STOPPING' });
    const stopping = service.shutdown();
    await expect(service.open({ projectId })).rejects.toMatchObject({
      code: 'TERMINAL_SERVICE_STOPPING',
    });
    expect(loadCount).toBe(1);
    finishLoad();
    await rejected;
    await stopping;
    expect(spawnCount).toBe(0);
  });

  it('可用时分离 open/input/resize/output/close 生命周期', async () => {
    const pty = new FakePty();
    let spawnOptions: IPtyForkOptions | undefined;
    process.env.AGENTHUB_TEST_SECRET = 'do-not-forward';
    process.env.AGENTHUB_PROJECT_OWNER_UID = '1234';
    process.env.AGENTHUB_PROJECT_OWNER_GID = '2345';
    const published: Array<{ topic: string; event: Record<string, unknown> }> = [];
    const service = new TerminalService(
      new ProjectRepository(database.db),
      { publish: (topic, event) => published.push({ topic, event }) },
      async () =>
        ({
          spawn: (_file: string, _args: string[], options: IPtyForkOptions) => {
            spawnOptions = options;
            return pty as unknown as IPty;
          },
        }) as never,
    );
    const terminal = await service.open({ projectId, cols: 100, rows: 28 });
    await service.input(terminal.id, 'pwd\r');
    await service.resize(terminal.id, 140, 40);
    pty.emitData('fixture output');
    await service.close(terminal.id);

    expect(pty.writes).toEqual(['pwd\r']);
    expect(pty.resizes).toEqual([[140, 40]]);
    expect(pty.killed).toBe(true);
    expect(spawnOptions?.uid).toBe(1234);
    expect(spawnOptions?.gid).toBe(2345);
    expect(spawnOptions?.env).toHaveProperty('PATH');
    expect(spawnOptions?.env).not.toHaveProperty('AGENTHUB_TEST_SECRET');
    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: `terminal:${terminal.id}`,
          event: expect.objectContaining({ type: 'terminal.output', data: 'fixture output' }),
        }),
        expect.objectContaining({
          topic: `terminal:${terminal.id}`,
          event: expect.objectContaining({ type: 'terminal.closed', reason: 'USER' }),
        }),
      ]),
    );
    delete process.env.AGENTHUB_TEST_SECRET;
    delete process.env.AGENTHUB_PROJECT_OWNER_UID;
    delete process.env.AGENTHUB_PROJECT_OWNER_GID;
  });
});

class FakePty {
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  killed = false;
  private dataHandler: ((data: string) => void) | undefined;
  private exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;

  onData(handler: (data: string) => void) {
    this.dataHandler = handler;
    return { dispose: () => undefined };
  }
  onExit(handler: (event: { exitCode: number; signal?: number }) => void) {
    this.exitHandler = handler;
    return { dispose: () => undefined };
  }
  write(data: string) {
    this.writes.push(data);
  }
  resize(cols: number, rows: number) {
    this.resizes.push([cols, rows]);
  }
  kill() {
    this.killed = true;
    this.exitHandler?.({ exitCode: 0 });
  }
  emitData(data: string) {
    this.dataHandler?.(data);
  }
}
