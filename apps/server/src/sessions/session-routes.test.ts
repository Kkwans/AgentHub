import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { SessionService } from './session-service.js';

const sessionId = '11111111-1111-4111-8111-111111111111';

describe('Session messages REST window', () => {
  it('无参数仍返回完整数组，窗口参数按原样传给服务', async () => {
    const service = {
      listMessages: vi.fn(async (_id: string, options?: unknown) =>
        options ? [{ sequence: 3 }, { sequence: 4 }] : [{ sequence: 1 }, { sequence: 2 }],
      ),
    };
    const app = createApp({ sessions: service as unknown as SessionService });

    const full = await request(app).get(`/api/v1/sessions/${sessionId}/messages`);
    expect(full.status).toBe(200);
    expect(full.body.data).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(service.listMessages).toHaveBeenNthCalledWith(1, sessionId, undefined);

    const window = await request(app).get(
      `/api/v1/sessions/${sessionId}/messages?beforeSequence=5&limit=2`,
    );
    expect(window.status).toBe(200);
    expect(window.body.data).toEqual([{ sequence: 3 }, { sequence: 4 }]);
    expect(service.listMessages).toHaveBeenNthCalledWith(2, sessionId, {
      beforeSequence: 5,
      limit: 2,
    });
  });

  it('拒绝非法 limit、beforeSequence 和未知查询参数', async () => {
    const service = { listMessages: vi.fn(async () => []) };
    const app = createApp({ sessions: service as unknown as SessionService });

    for (const query of ['limit=0', 'limit=201', 'beforeSequence=-1', 'cursor=2']) {
      const response = await request(app).get(`/api/v1/sessions/${sessionId}/messages?${query}`);
      expect(response.status).toBe(400);
    }
    expect(service.listMessages).not.toHaveBeenCalled();
  });
});
