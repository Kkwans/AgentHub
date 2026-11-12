import { randomUUID } from 'node:crypto';
import {
  AgentRepository,
  ApprovalRepository,
  createPgliteDatabase,
  EventRepository,
  ExecutionTargetRepository,
  GoalRepository,
  MessageRepository,
  ProjectRepository,
  PromptRepository,
  RunRepository,
  SessionRepository,
  SkillRepository,
  TaskRepository,
} from '@agenthub/db';
import {
  FakeAgentAdapter,
  type AgentTurnInput,
  type CreateAgentSessionInput,
} from '@agenthub/agent-core';
import pino from 'pino';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentService } from '../agents/agent-service.js';
import { createApp } from '../app.js';
import { PromptService } from '../promptos/prompt-service.js';
import { SessionService } from '../sessions/session-service.js';
import { TaskService } from './task-service.js';

class CaptureAdapter extends FakeAgentAdapter {
  readonly turns: AgentTurnInput[] = [];
  createdSessions = 0;
  constructor() {
    super({ scenario: 'idle' });
  }
  override async createSession(input: CreateAgentSessionInput) {
    this.createdSessions += 1;
    const handle = await super.createSession(input);
    const send = handle.sendTurn.bind(handle);
    handle.sendTurn = async (turn) => {
      this.turns.push(turn);
      return send(turn);
    };
    return handle;
  }
}

describe('Task 明确选择 PromptOS 的持久化与真实 Run 链路', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanups.splice(0).reverse()) await close();
  });

  async function fixture() {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const agents = new AgentRepository(database.db);
    const goals = new GoalRepository(database.db);
    const tasks = new TaskRepository(database.db);
    const sessions = new SessionRepository(database.db);
    const runs = new RunRepository(database.db);
    const prompts = new PromptRepository(database.db);
    const targetId = randomUUID();
    const projectId = randomUUID();
    const agentId = randomUUID();
    await targets.create({
      id: targetId,
      name: '测试环境',
      kind: 'LOCAL_HOST',
      hostname: 'fixture',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await projects.create({
      id: projectId,
      name: '当前项目',
      targetId,
      rootPath: '/tmp',
      realRootPath: '/tmp',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    await agents.create({
      id: agentId,
      targetId,
      name: '确定性 Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const promptos = new PromptService(prompts, new SkillRepository(database.db), projects);
    const adapter = new CaptureAdapter();
    const agentService = new AgentService(
      agents,
      targets,
      {
        launch: async () => {
          throw new Error('禁止真实进程');
        },
      },
      () => adapter,
    );
    const sessionService = new SessionService(
      sessions,
      runs,
      new MessageRepository(database.db),
      new EventRepository(database.db),
      new ApprovalRepository(database.db),
      projects,
      agentService,
      { publish: () => undefined },
      { readHead: async () => undefined },
      promptos,
    );
    const service = new TaskService(goals, tasks, projects, sessionService, promptos);
    const app = createApp({ tasks: service, promptos, logger: pino({ level: 'silent' }) });
    cleanups.push(async () => {
      await sessionService.shutdown();
      await database.close();
    });
    const makePrompt = async (
      text = '选定资产内容',
      scope: string | undefined = projectId,
      variables?: Record<string, unknown>,
    ) => {
      const prompt = await promptos.create({
        ...(scope ? { projectId: scope } : {}),
        key: `test/${randomUUID()}`,
        name: '明确选择的资产',
        kind: 'SYSTEM',
        type: 'TEXT',
      });
      const version = await promptos.createVersion(prompt.id, {
        content: { text },
        ...(variables ? { variables } : {}),
      });
      return { prompt, version };
    };
    return {
      database,
      projects,
      tasks,
      sessions,
      runs,
      prompts,
      promptos,
      adapter,
      service,
      app,
      projectId,
      agentId,
      targetId,
      makePrompt,
    };
  }

  it('创建时固定 production 版本，后续移动标签不改变任务；保留 Goal/正文与 Run 来源', async () => {
    const f = await fixture();
    const asset = await f.makePrompt('production 原始内容');
    await f.promptos.moveLabel(asset.prompt.id, 'production', asset.version.id);
    const v2 = await f.promptos.createVersion(asset.prompt.id, {
      content: { text: '不能意外注入的新版' },
    });
    const projectAsset = await f.makePrompt('项目附加上下文');
    const projectBinding = await f.promptos.createBinding({
      targetType: 'PROJECT',
      targetId: f.projectId,
      slot: 'RULES',
      promptId: projectAsset.prompt.id,
      selectorType: 'VERSION',
      versionId: projectAsset.version.id,
    });
    const goal = await f.service.createGoal({ projectId: f.projectId, title: '保留目标归属' });
    const task = await f.service.createTask({
      projectId: f.projectId,
      goalId: goal.id,
      title: '主目标',
      description: '补充上下文',
      acceptanceCriteria: '验收标准内容',
      selectedPrompt: { promptId: asset.prompt.id },
    });
    expect(task.goalId).toBe(goal.id);
    const bindings = await f.promptos.listBindings({ targetType: 'TASK', targetId: task.id });
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      slot: 'TASK_PRIMER',
      selectorType: 'VERSION',
      versionId: asset.version.id,
      label: null,
    });
    await f.promptos.moveLabel(asset.prompt.id, 'production', v2.id);
    await f.service.transitionTask(task.id, 'READY');
    const started = await f.service.startTask(task.id, { agentId: f.agentId });
    const text = f.adapter.turns[0]?.text ?? '';
    expect(text).toContain('production 原始内容');
    expect(text).not.toContain('不能意外注入的新版');
    expect(text).toContain(
      '[用户任务]\n主目标\n\n补充说明：\n补充上下文\n\n验收标准：\n验收标准内容',
    );
    expect(text.indexOf('项目附加上下文')).toBeLessThan(text.indexOf('production 原始内容'));
    expect(text.indexOf('production 原始内容')).toBeLessThan(text.indexOf('[用户任务]'));
    expect((await f.runs.get(started.run.id))?.metadataJson).toMatchObject({
      promptContext: {
        items: [
          expect.objectContaining({ bindingId: projectBinding.id }),
          expect.objectContaining({
            promptId: asset.prompt.id,
            versionId: asset.version.id,
            contentHash: asset.version.contentHash,
            targetType: 'TASK',
            slot: 'TASK_PRIMER',
          }),
        ],
      },
    });
    expect(await f.promptos.listBindings({ targetType: 'PROJECT', targetId: f.projectId })).toEqual(
      [projectBinding],
    );
  });

  it('HTTP 创建解析 selectedPrompt 并接受全局资产与明确版本', async () => {
    const f = await fixture();
    const asset = await f.makePrompt('全局旧版', '');
    await f.promptos.createVersion(asset.prompt.id, { content: { text: '全局最新版' } });
    const response = await request(f.app)
      .post('/api/v1/tasks')
      .send({
        projectId: f.projectId,
        title: 'API 创建',
        selectedPrompt: { promptId: asset.prompt.id, versionId: asset.version.id },
      });
    expect(response.status).toBe(201);
    expect(
      await f.promptos.listBindings({ targetType: 'TASK', targetId: response.body.data.id }),
    ).toEqual([
      expect.objectContaining({ promptId: asset.prompt.id, versionId: asset.version.id }),
    ]);
    const invalid = await request(f.app)
      .post('/api/v1/tasks')
      .send({
        projectId: f.projectId,
        title: '非法 selector',
        selectedPrompt: { promptId: asset.prompt.id, versionId: 'not-a-uuid' },
      });
    expect(invalid.status).toBe(400);
    expect(await f.tasks.list({ projectId: f.projectId })).toHaveLength(1);
  });

  it('没有 production 时固定 latest，缺少变量在创建 Session 之前拒绝且可明确重试', async () => {
    const f = await fixture();
    const asset = await f.makePrompt('处理 {{ subject }}', f.projectId, {
      type: 'object',
      properties: { subject: { type: 'string' } },
      required: ['subject'],
    });
    const task = await f.service.createTask({
      projectId: f.projectId,
      title: '需要变量',
      selectedPrompt: { promptId: asset.prompt.id },
    });
    await f.service.transitionTask(task.id, 'READY');
    const rejected = await request(f.app)
      .post(`/api/v1/tasks/${task.id}/start`)
      .send({ agentId: f.agentId });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toMatchObject({
      code: 'TASK_PROMPT_VARIABLES_MISSING',
      details: { missingVariables: ['subject'] },
    });
    expect(f.adapter.createdSessions).toBe(0);
    expect(await f.sessions.list(f.projectId)).toHaveLength(0);
    expect(await f.service.getTask(task.id)).toMatchObject({ status: 'READY', sessionId: null });
    const started = await request(f.app)
      .post(`/api/v1/tasks/${task.id}/start`)
      .send({ agentId: f.agentId, promptVariables: { subject: '用户明确输入' } });
    expect(started.status).toBe(201);
    expect(f.adapter.turns[0]?.text).toContain('处理 用户明确输入');
  });

  it('拒绝跨项目、归档、无版本资产及不属于该资产的版本，不留下 Task', async () => {
    const f = await fixture();
    const otherProject = randomUUID();
    await f.projects.create({
      id: otherProject,
      name: '另一个项目',
      targetId: f.targetId,
      rootPath: '/tmp/other',
      realRootPath: '/tmp/other',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    const other = await f.makePrompt('其他项目内容', otherProject);
    await expect(
      f.service.createTask({
        projectId: f.projectId,
        title: '跨项目',
        selectedPrompt: { promptId: other.prompt.id },
      }),
    ).rejects.toMatchObject({ code: 'TASK_PROMPT_PROJECT_MISMATCH' });
    const archived = await f.makePrompt();
    await f.promptos.archive(archived.prompt.id);
    await expect(
      f.service.createTask({
        projectId: f.projectId,
        title: '归档',
        selectedPrompt: { promptId: archived.prompt.id },
      }),
    ).rejects.toMatchObject({ code: 'PROMPT_NOT_FOUND' });
    const empty = await f.promptos.create({
      projectId: f.projectId,
      key: 'test/empty',
      name: '尚无版本',
      kind: 'TASK',
      type: 'TEXT',
    });
    await expect(
      f.service.createTask({
        projectId: f.projectId,
        title: '无版本',
        selectedPrompt: { promptId: empty.id },
      }),
    ).rejects.toMatchObject({ code: 'PROMPT_LABEL_NOT_FOUND' });
    const valid = await f.makePrompt();
    await expect(
      f.service.createTask({
        projectId: f.projectId,
        title: '错误版本',
        selectedPrompt: { promptId: valid.prompt.id, versionId: other.version.id },
      }),
    ).rejects.toMatchObject({ code: 'PROMPT_VERSION_NOT_FOUND' });
    expect(await f.tasks.list({ projectId: f.projectId })).toHaveLength(0);
  });

  it('绑定写入失败回滚整个 Task 创建事务', async () => {
    const f = await fixture();
    const asset = await f.makePrompt();
    const taskId = randomUUID();
    await expect(
      f.tasks.createWithPromptBinding(
        { id: taskId, projectId: f.projectId, title: '必须回滚', status: 'BACKLOG' },
        { promptId: asset.prompt.id, versionId: randomUUID() },
      ),
    ).rejects.toThrow();
    expect(await f.tasks.get(taskId)).toBeUndefined();
    expect(await f.promptos.listBindings({ targetType: 'TASK', targetId: taskId })).toHaveLength(0);
  });

  it('创建后资产归档时安全拒绝启动，旧客户端未选择资产保持兼容', async () => {
    const f = await fixture();
    const asset = await f.makePrompt();
    const task = await f.service.createTask({
      projectId: f.projectId,
      title: '后来归档',
      selectedPrompt: { promptId: asset.prompt.id },
    });
    await f.service.transitionTask(task.id, 'READY');
    await f.promptos.archive(asset.prompt.id);
    await expect(f.service.startTask(task.id, { agentId: f.agentId })).rejects.toMatchObject({
      code: 'TASK_PROMPT_RESOLUTION_FAILED',
      details: { reasonCode: 'PROMPT_NOT_FOUND' },
    });
    expect(f.adapter.createdSessions).toBe(0);
    const legacy = await f.service.createTask({ projectId: f.projectId, title: '旧调用保留' });
    expect(await f.promptos.listBindings({ targetType: 'TASK', targetId: legacy.id })).toHaveLength(
      0,
    );
    await f.service.transitionTask(legacy.id, 'READY');
    await f.service.startTask(legacy.id, { agentId: f.agentId });
    expect(f.adapter.turns[0]?.text).toContain('旧调用保留');
  });
});
