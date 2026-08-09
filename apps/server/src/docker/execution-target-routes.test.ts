import { createPgliteDatabase, ExecutionTargetRepository } from '@agenthub/db';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { DockerControlService, type DockerCommandRunner } from './docker-control.js';
import { ExecutionTargetService } from './execution-target-service.js';

const containerId = 'c'.repeat(64);

describe('Execution Target API', () => {
  let closeDatabase: () => Promise<void>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    closeDatabase = database.close;
    const repository = new ExecutionTargetRepository(database.db);
    let running = false;
    const runner: DockerCommandRunner = {
      run: async (args) => {
        if (args[0] === 'start') running = true;
        if (args[0] === 'stop') running = false;
        const state = {
          id: containerId,
          name: 'claude-code',
          status: running ? 'running' : 'exited',
          running,
          mounts: [],
        };
        return {
          exitCode: 0,
          signal: null,
          stdout: args[0] === 'inspect' ? JSON.stringify(state) : containerId,
          stderr: '',
          truncated: false,
          timedOut: false,
          canceled: false,
          durationMs: 1,
        };
      },
    };
    const docker = new DockerControlService(runner, repository);
    const service = new ExecutionTargetService(repository, docker);
    app = createApp({ executionTargets: service, logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('注册、预检、启动和停止显式 Docker target', async () => {
    const created = await request(app).post('/api/v1/execution-targets').send({
      name: 'Claude Code 容器',
      kind: 'DOCKER_CONTAINER',
      hostname: 'test-nas',
      os: 'linux',
      arch: 'arm64',
      containerName: 'claude-code',
      expectedContainerId: containerId,
      startPolicy: 'MANUAL',
      workspaceMappings: [],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      kind: 'DOCKER_CONTAINER',
      status: 'STOPPED',
      expectedContainerId: containerId,
    });
    const id = created.body.data.id as string;

    const preflight = await request(app).post(`/api/v1/execution-targets/${id}/preflight`).send({});
    expect(preflight.body.data.status).toBe('STOPPED');

    const started = await request(app).post(`/api/v1/execution-targets/${id}/start`);
    expect(started.body.data.running).toBe(true);

    const stopped = await request(app).post(`/api/v1/execution-targets/${id}/stop`);
    expect(stopped.body.data.running).toBe(false);

    const listed = await request(app).get('/api/v1/execution-targets');
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].status).toBe('STOPPED');
  });
});
