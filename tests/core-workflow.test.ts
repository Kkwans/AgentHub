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
} from '../packages/db/src/index.js';
import { FakeAgentAdapter } from '../packages/agent-core/src/index.js';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentService } from '../apps/server/src/agents/agent-service.js';
import { DashboardService } from '../apps/server/src/dashboard/dashboard-service.js';
import { PromptService } from '../apps/server/src/promptos/prompt-service.js';
import { SessionService, type GitHeadProbe } from '../apps/server/src/sessions/session-service.js';
import { TaskService } from '../apps/server/src/tasks/task-service.js';

describe('AgentHub 核心工程闭环', () => {
  const databases: Array<Awaited<ReturnType<typeof createPgliteDatabase>>> = [];
  const sessionServices: SessionService[] = [];

  afterEach(async () => {
    await Promise.all(sessionServices.splice(0).map((service) => service.shutdown()));
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it('贯通 Project → PromptOS → Task → Agent → Approval → Git → 人工审阅', async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    databases.push(database);
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const agents = new AgentRepository(database.db);
    const sessions = new SessionRepository(database.db);
    const runs = new RunRepository(database.db);
    const messages = new MessageRepository(database.db);
    const events = new EventRepository(database.db);
    const approvals = new ApprovalRepository(database.db);
    const goals = new GoalRepository(database.db);
    const tasks = new TaskRepository(database.db);
    const targetId = randomUUID();
    const projectId = randomUUID();
    const agentId = randomUUID();
    await targets.create({
      id: targetId,
      name: 'E2E 宿主机',
      kind: 'LOCAL_HOST',
      hostname: 'fixture',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await projects.create({
      id: projectId,
      name: 'E2E Project',
      targetId,
      rootPath: '/tmp',
      realRootPath: '/tmp',
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    await agents.create({
      id: agentId,
      targetId,
      name: 'E2E Fake Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });

    const promptos = new PromptService(
      new PromptRepository(database.db),
      new SkillRepository(database.db),
      projects,
    );
    const prompt = await promptos.create({
      projectId,
      key: 'e2e/safe-execution',
      name: 'E2E 安全执行',
      kind: 'SYSTEM',
      type: 'TEXT',
    });
    await promptos.createVersion(prompt.id, {
      content: { text: '仅执行可回滚变更，并报告验证证据。' },
    });
    await promptos.createBinding({
      targetType: 'PROJECT',
      targetId: projectId,
      slot: 'SYSTEM',
      promptId: prompt.id,
      selectorType: 'LABEL',
      label: 'latest',
      priority: 10,
    });

    const fakeAdapter = new FakeAgentAdapter({ scenario: 'approval' });
    const agentService = new AgentService(
      agents,
      targets,
      { launch: async () => Promise.reject(new Error('fixture 不启动真实进程')) },
      () => fakeAdapter,
    );
    const git = new FixtureGitProbe();
    const sessionService = new SessionService(
      sessions,
      runs,
      messages,
      events,
      approvals,
      projects,
      agentService,
      { publish: () => undefined },
      git,
      promptos,
    );
    sessionServices.push(sessionService);
    const taskService = new TaskService(goals, tasks, projects, sessionService);
    sessionService.setTaskLifecycleObserver(taskService);

    const goal = await taskService.createGoal({ projectId, title: '交付可审阅结果' });
    await taskService.transitionGoal(goal.id, 'ACTIVE');
    const task = await taskService.createTask({
      projectId,
      goalId: goal.id,
      title: '完成核心闭环',
      description: '运行确定性 Agent fixture',
      acceptanceCriteria: 'Approval exactly-once，Task 经过人工审阅',
    });
    await taskService.transitionTask(task.id, 'READY');
    const started = await taskService.startTask(task.id, { agentId });
    await waitFor(async () => (await runs.get(started.run.id))?.status === 'WAITING_APPROVAL');

    const [pending] = await sessionService.listApprovals(started.session.id);
    if (!pending) throw new Error('E2E 未产生 Approval');
    await sessionService.resolveApproval(pending.id, 'allow');
    await sessionService.resolveApproval(pending.id, 'allow');
    await waitFor(async () => (await taskService.getTask(task.id)).status === 'WAITING_REVIEW');

    const completedRun = await runs.get(started.run.id);
    expect(completedRun).toMatchObject({
      status: 'COMPLETED',
      gitBeforeSha: 'git-before',
      gitAfterSha: 'git-after',
    });
    expect(completedRun?.metadataJson).toMatchObject({
      promptContext: { items: [expect.objectContaining({ promptId: prompt.id, label: 'latest' })] },
    });
    expect(git.snapshots).toEqual(['BEFORE', 'AFTER']);
    expect((await messages.list(started.session.id)).map((message) => message.role)).toEqual([
      'USER',
      'ASSISTANT',
    ]);
    expect((await approvals.get(pending.id))?.status).toBe('APPROVED');

    await taskService.reviewTask(task.id, { decision: 'APPROVE' });
    expect(await taskService.getTask(task.id)).toMatchObject({ status: 'DONE' });
    const dashboard = await new DashboardService(
      sessions,
      tasks,
      runs,
      approvals,
      agents,
    ).snapshot();
    expect(dashboard.recentResults).toEqual([
      expect.objectContaining({ id: started.run.id, gitOutcome: 'CHANGED' }),
    ]);
  }, 20_000);
});

class FixtureGitProbe implements GitHeadProbe {
  readonly snapshots: string[] = [];
  private readonly heads = ['git-before', 'git-after'];

  async readHead(): Promise<string | undefined> {
    return this.heads.shift();
  }

  async capture(
    _runId: string,
    _projectId: string,
    _cwd: string,
    type: 'BEFORE' | 'AFTER' | 'REVIEW',
  ): Promise<void> {
    this.snapshots.push(type);
  }
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('等待 E2E 状态超时');
}
