// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web api error boundary', () => {
  it('normalizes network failures before they reach ordinary-user UI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const failure = await api.get('/projects').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: 'HTTP_ERROR',
      message: '请求失败，请稍后重试。',
      status: 0,
    });
    expect((failure as Error).message).not.toContain('Failed to fetch');
  });

  it('normalizes non-JSON responses without exposing parser details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>暂时不可用</html>', { status: 502 })),
    );

    const failure = await api.get('/projects').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: 'HTTP_ERROR',
      message: '请求失败，请稍后重试。',
      status: 502,
    });
  });

  it('normalizes malformed JSON envelopes before they reach the UI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(null, { status: 200 })));

    const failure = await api.get('/projects').catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'HTTP_ERROR',
      message: '请求失败，请稍后重试。',
      status: 200,
    });
  });

  it('normalizes malformed error envelopes without throwing while reading the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: null }, { status: 500 })),
    );

    const failure = await api.get('/projects').catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'HTTP_ERROR',
      message: '请求失败，请稍后重试。',
      status: 500,
    });
  });
});
