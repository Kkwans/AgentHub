import { randomUUID } from 'node:crypto';

import {
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  PromptRepository,
  SkillRepository,
} from '@agenthub/db';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { PromptService } from './prompt-service.js';

describe('PromptOS REST', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let app: ReturnType<typeof createApp>;
  let projectId: string;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    const targetId = randomUUID();
    projectId = randomUUID();
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    await targets.create({
      id: targetId,
      name: '测试宿主机',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await projects.create({
      id: projectId,
      name: 'API Project',
      targetId,
      rootPath: '/tmp',
      realRootPath: '/tmp',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    const service = new PromptService(
      new PromptRepository(database.db),
      new SkillRepository(database.db),
      projects,
    );
    app = createApp({ promptos: service, logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => database.close());

  it('完成 Prompt → Version → Label → Render → Binding resolve API 链路', async () => {
    const created = await request(app).post('/api/v1/prompts').send({
      projectId,
      key: 'api/task-primer',
      name: '任务引导',
      kind: 'TASK',
      type: 'TEXT',
    });
    expect(created.status).toBe(201);
    const promptId = String(created.body.data.id);

    const version1 = await request(app)
      .post(`/api/v1/prompts/${promptId}/versions`)
      .send({
        content: { text: '任务：{{ task }}' },
        variables: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } },
        changelog: '初始版本',
      });
    const version2 = await request(app)
      .post(`/api/v1/prompts/${promptId}/versions`)
      .send({
        content: { text: '请完成任务：{{ task }}' },
        variables: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } },
        changelog: '明确措辞',
      });
    expect(version1.status).toBe(201);
    expect(version2.body.data.version).toBe(2);

    const labels = await request(app).get(`/api/v1/prompts/${promptId}/labels`);
    expect(labels.body.data).toEqual([expect.objectContaining({ label: 'latest', version: 2 })]);
    const protectedLatest = await request(app)
      .put(`/api/v1/prompts/${promptId}/labels/latest`)
      .send({ versionId: version1.body.data.id });
    expect(protectedLatest.status).toBe(409);
    expect(protectedLatest.body.error.code).toBe('PROMPT_LATEST_LABEL_MANAGED');

    const production = await request(app)
      .put(`/api/v1/prompts/${promptId}/labels/production`)
      .send({ versionId: version1.body.data.id });
    expect(production.status).toBe(200);
    const render = await request(app)
      .post(`/api/v1/prompts/${promptId}/render`)
      .send({ label: 'production', variables: { task: '实现 API' } });
    expect(render.body.data).toMatchObject({
      version: 1,
      label: 'production',
      text: '任务：实现 API',
      missingVariables: [],
    });

    const binding = await request(app).post('/api/v1/prompt-bindings').send({
      targetType: 'PROJECT',
      targetId: projectId,
      slot: 'TASK_PRIMER',
      promptId,
      selectorType: 'LABEL',
      label: 'production',
      priority: 10,
    });
    expect(binding.status).toBe(201);
    const context = await request(app)
      .post('/api/v1/prompt-context/resolve')
      .send({
        projectId,
        variables: { task: '实现 API' },
      });
    expect(context.body.data).toMatchObject({ ready: true, missingVariables: [] });
    expect(context.body.data.items[0]).toMatchObject({
      bindingId: binding.body.data.id,
      version: 1,
      label: 'production',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
