import request from 'supertest';
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
    const app = createApp({ worktrees: service as unknown as WorktreeTaskService });

    const queued = await request(app)
      .post(`/api/v1/tasks/${taskId}/worktree/queue`)
      .send({ agentId, baseBranch: 'main' });
    expect(queued.status).toBe(202);
    expect(service.queueTask).toHaveBeenCalledWith(taskId, { agentId, baseBranch: 'main' });

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
          .send({ commitMessage: 'feat(task): 完成隔离任务' })
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
