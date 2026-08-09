import { describe, expect, it } from 'vitest';

import { DashboardService } from './dashboard-service.js';

describe('Dashboard service', () => {
  it('只汇总可操作状态并计算 Git outcome', async () => {
    const service = new DashboardService(
      {
        list: async () => [
          { id: 's1', status: 'RUNNING' },
          { id: 's2', status: 'READY' },
        ],
      },
      {
        list: async () => [
          { id: 't1', status: 'WAITING_REVIEW' },
          { id: 't2', status: 'DONE' },
        ],
      },
      {
        listRecent: async () => [
          {
            id: 'r1',
            status: 'COMPLETED',
            gitBeforeSha: 'before',
            gitAfterSha: 'after',
          },
          {
            id: 'r2',
            status: 'FAILED',
            gitBeforeSha: null,
            gitAfterSha: null,
          },
          {
            id: 'r3',
            status: 'RUNNING',
            gitBeforeSha: 'same',
            gitAfterSha: 'same',
          },
        ],
      },
      { listPending: async () => [{ id: 'a1' }] },
      { list: async () => [{ id: 'agent1', status: 'READY' }] },
    );

    const result = await service.snapshot();
    expect(result.runningSessions.map((item) => item.id)).toEqual(['s1']);
    expect(result.attentionTasks.map((item) => item.id)).toEqual(['t1']);
    expect(result.pendingApprovals).toHaveLength(1);
    expect(result.recentResults.map((item) => item.gitOutcome)).toEqual(['CHANGED', 'UNAVAILABLE']);
  });
});
