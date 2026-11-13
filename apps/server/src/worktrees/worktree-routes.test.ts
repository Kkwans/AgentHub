import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import type { AuthPrincipal } from '../auth/auth-service.js';
import { createWorktreeRouter } from './worktree-routes.js';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { WorktreeTaskService } from './worktree-task-service.js';

const taskId = '11111111-1111-4111-8111-111111111111';
const executionId = '22222222-2222-4222-8222-222222222222';
const agentId = '33333333-3333-4333-8333-333333333333';

describe('Worktree REST 契约', () => {
  it('以 202 接收 Task queue，并提供 Review/Merge/Rework/Cancel 路由', async () => {
    const service = {
      list: vi.fn(async () => [{ id: executionId, status: 'QUEUED' }]),
      get: vi.fn(async () => ({ id: executionId, status: 'REVIEW' })),
      queueTask: vi.fn(async () => ({ execution: { id: executionId, status: 'QUEUED' } })),
      review: vi.fn(async () => ({ id: executionId, patch: 'diff' })),
      rework: vi.fn(async () => ({ id: executionId, status: 'RUNNING' })),
      merge: vi.fn(async () => ({ execution: { id: executionId, status: 'DONE' } })),
      cancel: vi.fn(async () => ({ execution: { id: executionId, status: 'CANCELED' } })),
    };
    const app = express();
    app.use((_request, response, next) => {
      response.locals.authPrincipal = { kind: 'local_trusted', role: 'ADMIN' };
      next();
    });
    app.use(createApp({ worktrees: service as unknown as WorktreeTaskService }));

    const queued = await request(app)
      .post(`/api/v1/tasks/${taskId}/worktree/queue`)
      .send({ agentId, baseBranch: 'main' });
    expect(queued.status).toBe(202);
    expect(service.queueTask).toHaveBeenCalledWith(
      taskId,
      { agentId, baseBranch: 'main' },
      'local-trusted',
    );

    expect(
      (await request(app).get(`/api/v1/worktree-executions/${executionId}/review`)).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/worktree-executions/${executionId}/rework`)
          .send({ feedback: '继续补充测试' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/worktree-executions/${executionId}/merge`)
          .send({
            expectedRunId: taskId,
            expectedOperationId: agentId,
            commitMessage: 'feat(task): 完成隔离任务',
          })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/v1/worktree-executions/${executionId}/cancel`)).status,
    ).toBe(200);
  });

  it('拒绝缺少 Agent 或空 Rework feedback 的请求', async () => {
    const service = {
      queueTask: vi.fn(),
      rework: vi.fn(),
    };
    const app = createApp({ worktrees: service as unknown as WorktreeTaskService });

    expect(
      (await request(app).post(`/api/v1/tasks/${taskId}/worktree/queue`).send({})).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/v1/worktree-executions/${executionId}/rework`)
          .send({ feedback: '   ' })
      ).status,
    ).toBe(400);
    expect(service.queueTask).not.toHaveBeenCalled();
    expect(service.rework).not.toHaveBeenCalled();
  });
});

function ownerRoute(principal?: AuthPrincipal) {
  const service = { queueTask: vi.fn(async () => ({ execution: { id: executionId } })) };
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => {
    response.locals.authPrincipal = principal;
    next();
  });
  app.use(createWorktreeRouter(service as unknown as WorktreeTaskService));
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error.status ?? 500).json({ code: error.code });
  };
  app.use(errors);
  return { app, service };
}
it.each([
  [
    {
      kind: 'browser_session',
      accountId: 'account-one',
      sessionId: 'session-one',
      username: 'user',
      role: 'ADMIN',
    },
    'account:account-one',
  ],
  [{ kind: 'api_token', tokenId: 'token-one', role: 'ADMIN' }, 'token:token-one'],
  [{ kind: 'local_trusted', role: 'ADMIN' }, 'local-trusted'],
] as const)(
  'Worktree queue 从认证 principal %j 派生 owner，忽略 body 伪造值',
  async (principal, owner) => {
    const { app, service } = ownerRoute(principal);
    const result = await request(app).post(`/tasks/${taskId}/worktree/queue`).send({
      agentId,
      ownerScope: 'account:attacker',
      gitOwnerScope: 'account:attacker',
      gitCreateOperationId: executionId,
    });
    expect(result.status).toBe(202);
    expect(service.queueTask).toHaveBeenCalledWith(taskId, { agentId }, owner);
  },
);
it('缺失认证 principal 即使 body 提供 owner 也不得入队', async () => {
  const { app, service } = ownerRoute();
  const result = await request(app)
    .post(`/tasks/${taskId}/worktree/queue`)
    .send({ agentId, ownerScope: 'local-trusted' });
  expect(result.status).toBe(401);
  expect(result.body.code).toBe('AUTH_REQUIRED');
  expect(service.queueTask).not.toHaveBeenCalled();
});

it.each([
  {},
  { expectedRunId: taskId },
  { expectedOperationId: agentId },
  { expectedRunId: taskId, expectedOperationId: 'bad' },
])('merge 拒绝缺少或错误 CAS token %j', async (body) => {
  const service = { merge: vi.fn() };
  const app = createApp({ worktrees: service as unknown as WorktreeTaskService });
  const result = await request(app)
    .post(`/api/v1/worktree-executions/${executionId}/merge`)
    .send(body);
  expect(result.status).toBe(400);
  expect(service.merge).not.toHaveBeenCalled();
});

it('显式 retry token 原样传给原子服务，不能由路由生成新身份', async () => {
  const service = { merge: vi.fn(async () => ({ status: 'DONE' })) };
  const app = createApp({ worktrees: service as unknown as WorktreeTaskService });
  const body = { expectedRunId: taskId, expectedOperationId: agentId, retryOfOperationId: agentId };
  const result = await request(app)
    .post(`/api/v1/worktree-executions/${executionId}/merge`)
    .send(body);
  expect(result.status).toBe(200);
  expect(service.merge).toHaveBeenCalledExactlyOnceWith(executionId, body);
});
