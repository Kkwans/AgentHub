import { randomUUID } from 'node:crypto';
import {
  ApiTokenRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  GoalRepository,
  LocalAuthRepository,
  ProjectRepository,
  PromptRepository,
  SkillRepository,
  TaskRepository,
} from '@agenthub/db';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AuthService, type AuthPrincipal } from '../auth/auth-service.js';
import { PromptService } from '../promptos/prompt-service.js';
import { creationOwnerScope, taskCreationHash } from './task-creation-operation.js';
import { TaskService } from './task-service.js';

describe('持久 Task 创建操作', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let tasks: TaskRepository<(typeof database)['db']>;
  let projects: ProjectRepository<(typeof database)['db']>;
  let promptos: PromptService;
  let service: TaskService;
  let auth: AuthService;
  let projectId: string;
  let tokenA: string;
  let tokenB: string;
  let app: ReturnType<typeof createApp>;
  const logs: string[] = [];
  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    tasks = new TaskRepository(database.db);
    projects = new ProjectRepository(database.db);
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: '本地测试',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    projectId = randomUUID();
    await projects.create({
      id: projectId,
      name: '幂等测试',
      targetId: target.id,
      rootPath: '/tmp/idempotency',
      realRootPath: '/tmp/idempotency',
      status: 'ACTIVE',
      repoKind: 'NONE',
    });
    promptos = new PromptService(
      new PromptRepository(database.db),
      new SkillRepository(database.db),
      projects,
    );
    service = new TaskService(
      new GoalRepository(database.db),
      tasks,
      projects,
      {
        create: async () => {
          throw new Error('创建操作不得启动 Session');
        },
        startRun: async () => {
          throw new Error('创建操作不得启动 Run');
        },
      },
      promptos,
    );
    auth = new AuthService(
      new ApiTokenRepository(database.db),
      new LocalAuthRepository(database.db),
      'token',
    );
    tokenA = (await auth.createToken('测试 A')).token;
    tokenB = (await auth.createToken('测试 B')).token;
    app = createApp({
      auth,
      tasks: service,
      logger: pino(
        {},
        {
          write: (line) => {
            logs.push(line);
          },
        },
      ),
    });
  });
  afterAll(async () => {
    await database.close();
  });
  const post = (body: object, token = tokenA) =>
    request(app).post('/api/v1/tasks').set('authorization', `Bearer ${token}`).send(body);
  const recover = (operationId: string, token = tokenA) =>
    request(app)
      .get(`/api/v1/tasks/creation-operations/${operationId}`)
      .set('authorization', `Bearer ${token}`);
  async function asset() {
    const prompt = await promptos.create({
      projectId,
      key: `test/${randomUUID()}`,
      name: '选定资产',
      kind: 'TASK',
      type: 'TEXT',
    });
    const version = await promptos.createVersion(prompt.id, { content: { text: '固定版本' } });
    return { prompt, version };
  }
  it('相同操作并发仅创建一个 Task 和 binding，响应遗失后按身份恢复', async () => {
    const a = await asset();
    const operationId = randomUUID();
    const input = {
      projectId,
      title: '唯一创建',
      description: '完整说明',
      operationId,
      selectedPrompt: { promptId: a.prompt.id },
    };
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(input)));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const ids = new Set(responses.map((r) => r.body.data.id));
    expect(ids.size).toBe(1);
    const taskId = responses[0]!.body.data.id;
    expect((await tasks.list()).filter((t) => t.title === '唯一创建')).toHaveLength(1);
    expect(await promptos.listBindings({ targetType: 'TASK', targetId: taskId })).toHaveLength(1);
    expect((await recover(operationId)).body.data).toEqual({
      operationId,
      projectId,
      taskId,
      status: 'BACKLOG',
      sessionId: null,
    });
    expect((await recover(operationId, tokenB)).status).toBe(404);
    expect(
      (await request(app).get(`/api/v1/tasks/creation-operations/${operationId}`)).status,
    ).toBe(401);
    const otherOwner = await post(input, tokenB);
    expect(otherOwner.status).toBe(201);
    expect(otherOwner.body.data.id).not.toBe(taskId);
  });
  it('同一操作更改内容或项目拒绝，客户端伪造 owner_scope 无效', async () => {
    const operationId = randomUUID();
    const input = { projectId, title: '不能换内容', operationId };
    const created = await post(input);
    expect((await post({ ...input, title: '更改内容' })).body.error.code).toBe(
      'TASK_OPERATION_PAYLOAD_MISMATCH',
    );
    expect((await post({ ...input, projectId: randomUUID() })).status).toBe(409);
    expect(
      (await post({ ...input, ownerScope: 'forged', owner_scope: 'forged' })).body.data.id,
    ).toBe(created.body.data.id);
    expect((await recover(randomUUID())).body.error.code).toBe('TASK_CREATION_OPERATION_NOT_FOUND');
  });
  it('不同请求竞争同一操作时仅一个成功，另一个409', async () => {
    const operationId = randomUUID();
    const results = await Promise.all([
      post({ projectId, operationId, title: '竞争甲' }),
      post({ projectId, operationId, title: '竞争乙' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.error.code).toBe(
      'TASK_OPERATION_PAYLOAD_MISMATCH',
    );
    expect(
      (await tasks.list()).filter((task) => ['竞争甲', '竞争乙'].includes(task.title)),
    ).toHaveLength(1);
  });
  it('相同账户重新登录后仍可恢复，URL参数先验证UUID', async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    const credentials = { username: 'testowner', password: 'example-test-only-passphrase' };
    expect((await first.post('/api/v1/auth/setup').send(credentials)).status).toBe(201);
    const operationId = randomUUID();
    const created = await first
      .post('/api/v1/tasks')
      .send({ projectId, operationId, title: '账户级恢复' });
    expect(created.status).toBe(201);
    expect((await second.post('/api/v1/auth/login').send(credentials)).status).toBe(200);
    const recovered = await second.get(`/api/v1/tasks/creation-operations/${operationId}`);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.taskId).toBe(created.body.data.id);
    expect((await recover(operationId)).status).toBe(404);
    expect((await recover('invalid')).status).toBe(400);
  });
  it('AH002变量嵌套键序重放一致，改变值冲突且保留原值', async () => {
    const input = {
      projectId,
      title: '持久变量',
      operationId: randomUUID(),
      promptVariables: { subject: 'first', nested: { b: false, a: 0 }, list: [null, 'x'] },
    };
    const first = await post(input);
    expect(first.status).toBe(201);
    const replay = await post({
      ...input,
      promptVariables: { list: [null, 'x'], nested: { a: 0, b: false }, subject: 'first' },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.body.data.promptVariablesJson).toEqual(input.promptVariables);
    expect(
      (await post({ ...input, promptVariables: { ...input.promptVariables, subject: 'second' } }))
        .status,
    ).toBe(409);
    for (const promptVariables of [null, [], 'text'])
      expect((await post({ projectId, title: '非法变量', promptVariables })).status).toBe(400);
  });
  it('AH002空变量保持既有hash，非空值/数组顺序/特殊键不被canonical抹掉', () => {
    const input = { projectId: '11111111-1111-4111-8111-111111111111', title: 'legacy' };
    expect(taskCreationHash(input)).toBe(
      '8ed2d57f0e261325fbaf937d2dbf0ed5b97d2616e35621ffd693011b0a059c4e',
    );
    expect(taskCreationHash({ ...input, promptVariables: {} })).toBe(taskCreationHash(input));
    const values = [
      { v: 0 },
      { v: '0' },
      { v: false },
      { v: null },
      { v: '' },
      { v: [1, 2] },
      { v: [2, 1] },
      JSON.parse('{"__proto__":{"a":1}}') as Record<string, unknown>,
    ];
    expect(
      new Set(values.map((promptVariables) => taskCreationHash({ ...input, promptVariables })))
        .size,
    ).toBe(values.length);
  });

  it('所有UUID引用大小写等价，首次大写请求和小写重放不误判冲突', async () => {
    const a = await asset();
    const goal = await service.createGoal({ projectId, title: '归属目标' });
    const parent = await service.createTask({ projectId, title: '父任务' });
    const input = {
      projectId,
      goalId: goal.id,
      parentId: parent.id,
      title: 'UUID一致',
      operationId: randomUUID(),
      selectedPrompt: { promptId: a.prompt.id, versionId: a.version.id },
    };
    const upper = {
      ...input,
      projectId: projectId.toUpperCase(),
      goalId: goal.id.toUpperCase(),
      parentId: parent.id.toUpperCase(),
      operationId: input.operationId.toUpperCase(),
      selectedPrompt: {
        promptId: a.prompt.id.toUpperCase(),
        versionId: a.version.id.toUpperCase(),
      },
    };
    expect(taskCreationHash(upper)).toBe(taskCreationHash(input));
    const first = await post(upper);
    expect(first.status).toBe(201);
    const replay = await post(input);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
  });
  it('已提交操作在资产归档、标签变化后仍返回原 Task，不重新解析', async () => {
    const a = await asset();
    await promptos.moveLabel(a.prompt.id, 'production', a.version.id);
    const input = {
      projectId,
      title: '固定快照',
      operationId: randomUUID(),
      selectedPrompt: { promptId: a.prompt.id },
    };
    const first = await post(input);
    const next = await promptos.createVersion(a.prompt.id, { content: { text: '不应采用' } });
    await promptos.moveLabel(a.prompt.id, 'production', next.id);
    await promptos.archive(a.prompt.id);
    const replay = await post(input);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(
      (await promptos.listBindings({ targetType: 'TASK', targetId: first.body.data.id }))[0]
        ?.versionId,
    ).toBe(a.version.id);
  });
  it('binding写入失败回滚操作和Task，不把SQL正文写进HTTP日志，同key可重试', async () => {
    const a = await asset();
    const operationId = randomUUID();
    const secretText = `private-task-${randomUUID()}`;
    const input = {
      projectId,
      operationId,
      title: secretText,
      description: secretText,
      selectedPrompt: { promptId: a.prompt.id },
    };
    const spy = vi
      .spyOn(promptos, 'resolveTaskSelection')
      .mockResolvedValueOnce({ promptId: a.prompt.id, versionId: randomUUID() });
    const rejected = await post(input);
    spy.mockRestore();
    expect(rejected.status).toBe(500);
    expect((await recover(operationId)).status).toBe(404);
    expect((await tasks.list()).some((t) => t.title === secretText)).toBe(false);
    expect(logs.join('')).not.toContain(secretText);
    expect(logs.join('')).not.toContain(tokenA);
    const retry = await post(input);
    expect(retry.status).toBe(201);
    expect((await recover(operationId)).body.data.taskId).toBe(retry.body.data.id);
  });
  it('legacy不带operationId继续独立创建，非法UUID无写入', async () => {
    const first = await post({ projectId, title: '旧客户端' });
    const second = await post({ projectId, title: '旧客户端' });
    expect(first.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    expect((await post({ projectId, title: '非法key', operationId: 'invalid' })).status).toBe(400);
  });
  it('规范化默认字段与稳定认证账户，不绑定浏览器临时Session', () => {
    expect(taskCreationHash({ projectId, title: ' 标题 ' })).toBe(
      taskCreationHash({ title: '标题', projectId, priority: 0, position: '0' }),
    );
    expect(
      creationOwnerScope({
        kind: 'browser_session',
        accountId: 'account',
        sessionId: 'one',
        username: 'a',
        role: 'ADMIN',
      }),
    ).toBe(
      creationOwnerScope({
        kind: 'browser_session',
        accountId: 'account',
        sessionId: 'two',
        username: 'a',
        role: 'ADMIN',
      }),
    );
    expect(taskCreationHash({ projectId, title: '标题', position: '-000.00000000' })).toBe(
      taskCreationHash({ projectId, title: '标题' }),
    );
    expect(() => creationOwnerScope(undefined)).toThrow();
    expect(() =>
      creationOwnerScope({ kind: 'unknown', role: 'ADMIN' } as unknown as AuthPrincipal),
    ).toThrow();
    expect(creationOwnerScope({ kind: 'local_trusted', role: 'ADMIN' })).toBe('local-trusted');
  });
});
