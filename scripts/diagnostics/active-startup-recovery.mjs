import console from 'node:console';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as dbmod from '../../packages/db/dist/index.js';
import { FakeAgentAdapter } from '../../packages/agent-core/dist/index.js';
import { AgentService } from '../../apps/server/dist/agents/agent-service.js';
import { SessionService } from '../../apps/server/dist/sessions/session-service.js';
import { TaskService } from '../../apps/server/dist/tasks/task-service.js';
import { WorktreeTaskService } from '../../apps/server/dist/worktrees/worktree-task-service.js';
import { recoverRuntimeAfterRestart } from '../../apps/server/dist/startup-recovery.js';
const {
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  AgentRepository,
  TaskRepository,
  TaskStartAttemptRepository,
  RunRepository,
  SessionRepository,
  MessageRepository,
  EventRepository,
  ApprovalRepository,
  GoalRepository,
  WorktreeExecutionRepository,
} = dbmod;
// Isolated diagnostic: no real Agent, network, or existing project is used.
// Build first. Exit 2 means active-startup interference was reproduced.
// Fault injection is opt-in and applies only to the control's fake adapter.
// It verifies an early fixture error exits 1 rather than silently succeeding.
const injectEarlyFailure = process.argv.includes('--probe-early-failure');
async function waitForBarrier(inside, pending) {
  let timer;
  try {
    await Promise.race([
      inside,
      pending.then((outcome) => {
        throw new Error(
          `Startup settled before the barrier: ${outcome.ok ? 'fulfilled' : (outcome.code ?? outcome.message)}`,
        );
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('barrier not entered')), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
let interference = false;
console.log('start', new Date().toISOString());
for (const recover of [false, true]) {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-active-startup-'));
  let database, a, b, release, diagnosticError;
  const cleanupErrors = [];
  try {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    const db = database.db;
    const targets = new ExecutionTargetRepository(db),
      projects = new ProjectRepository(db),
      agents = new AgentRepository(db),
      tasks = new TaskRepository(db),
      attempts = new TaskStartAttemptRepository(db),
      runs = new RunRepository(db);
    const target = await targets.create({
      id: randomUUID(),
      name: 'probe',
      kind: 'LOCAL_HOST',
      hostname: 'fixture',
      os: 'linux',
      arch: 'x64',
      status: 'READY',
    });
    const project = await projects.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'probe',
      rootPath: temp,
      realRootPath: temp,
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    const agent = await agents.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'probe',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const task = await tasks.create({
      id: randomUUID(),
      projectId: project.id,
      title: 'probe',
      status: 'READY',
    });
    let entered;
    const inside = new Promise((r) => (entered = r)),
      barrier = new Promise((r) => (release = r));
    let creates = 0,
      closes = 0,
      sends = 0,
      bCreates = 0;
    const adapter = new FakeAgentAdapter({ scenario: 'idle' }),
      original = adapter.createSession.bind(adapter);
    adapter.createSession = async (input) => {
      creates++;
      if (injectEarlyFailure && !recover) throw new Error('Injected early fake-adapter failure');
      const handle = await original(input);
      const close = handle.close.bind(handle),
        send = handle.sendTurn.bind(handle);
      handle.close = async () => {
        closes++;
        return close();
      };
      handle.sendTurn = async (...args) => {
        sends++;
        return send(...args);
      };
      entered();
      await barrier;
      return handle;
    };
    const second = new FakeAgentAdapter({ scenario: 'idle' });
    second.createSession = async () => {
      bCreates++;
      throw new Error('B must not create');
    };
    function services(runtime) {
      const sessions = new SessionService(
        new SessionRepository(db),
        runs,
        new MessageRepository(db),
        new EventRepository(db),
        new ApprovalRepository(db),
        projects,
        new AgentService(
          agents,
          targets,
          {
            launch: async () => {
              throw new Error('must not launch');
            },
          },
          () => runtime,
        ),
        { publish: () => {} },
        { readHead: async () => undefined },
        undefined,
        {},
        undefined,
        new TaskStartAttemptRepository(db),
      );
      const taskService = new TaskService(
        new GoalRepository(db),
        tasks,
        projects,
        sessions,
        undefined,
        new TaskStartAttemptRepository(db),
      );
      const unexpected = async () => {
        throw new Error('must not invoke Git');
      };
      const worktrees = new WorktreeTaskService(
        new WorktreeExecutionRepository(db),
        tasks,
        projects,
        agents,
        targets,
        sessions,
        {
          inspectBase: unexpected,
          taskBranch: () => 'unused',
          create: unexpected,
          review: unexpected,
          commitAndMerge: unexpected,
        },
        { publish: () => {} },
      );
      return { sessions, tasks: taskService, worktrees, runs };
    }
    a = services(adapter);
    b = services(second);
    const pending = a.tasks.startTask(task.id, { agentId: agent.id }).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, code: error.code, message: error.message }),
    );
    await waitForBarrier(inside, pending);
    const before = (await attempts.getForTask(task.id))[0];
    assert.equal(before.phase, 'CREATE_ATTEMPTED');
    let recovery;
    if (recover) recovery = await recoverRuntimeAfterRestart(b);
    release();
    const outcome = await pending;
    const after = (await attempts.getForTask(task.id))[0],
      storedTask = await tasks.get(task.id),
      session = await new SessionRepository(db).get(after.sessionId);
    console.log(
      JSON.stringify(
        {
          recover,
          before: before.phase,
          after: after.phase,
          outcome: outcome.ok ? 'fulfilled' : outcome.code,
          taskStatus: storedTask.status,
          sessionStatus: session.status,
          runId: after.runId,
          creates,
          closes,
          sends,
          bCreates,
          recovery,
        },
        null,
        2,
      ),
    );
    assert.equal(creates, 1);
    assert.equal(bCreates, 0);
    if (recover && !outcome.ok) {
      assert.equal(outcome.code, 'TASK_SESSION_CREATE_UNKNOWN');
      assert.equal(after.phase, 'UNKNOWN');
      assert.equal(session.status, 'DISCONNECTED');
      assert.equal(storedTask.status, 'IN_PROGRESS');
      assert.equal(after.runId, null);
      assert.equal(sends, 0);
      assert.equal(closes, 1);
      assert.deepEqual(recovery.sessions.taskStarts.unknown, [after.id]);
      interference = true;
    } else {
      assert.equal(after.phase, 'RUN_ADMITTED');
      assert.equal(outcome.ok, true);
      assert.equal(sends, 1);
    }
  } catch (error) {
    diagnosticError = error;
  } finally {
    release?.();
    // Always attempt every cleanup, including when initialization/shutdown fails.
    for (const clean of [
      () => a?.sessions.shutdown(),
      () => b?.sessions.shutdown(),
      () => database?.close(),
      () => rm(temp, { recursive: true, force: true }),
    ]) {
      try {
        await clean();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      [...(diagnosticError ? [diagnosticError] : []), ...cleanupErrors],
      'Diagnostic or cleanup failed',
    );
  if (diagnosticError) throw diagnosticError;
}
console.log('end', new Date().toISOString());

console.log(
  JSON.stringify({
    interference,
    interpretation: interference
      ? 'Active service was changed by another startup recovery; not safe multi-instance operation.'
      : 'This controlled scenario was unaffected; not proof of network-partition safety.',
  }),
);
if (interference) process.exitCode = 2;
