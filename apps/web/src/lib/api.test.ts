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
  it.each([
    ['UNKNOWN', '资源清理结果未知'],
    ['ACTIVE_OWNED', '现有会话仍由系统管理'],
    ['HANDLE_CLOSE_RETURNED', '请先核对现有会话和 Agent 诊断'],
    ['NOT_ACQUIRED', '请先核对现有会话和 Agent 诊断'],
    ['unrecognized', '请先核对现有会话和 Agent 诊断'],
  ])('preserves safe session cleanup guidance for %s', async (handleCleanup, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'AGENT_SESSION_CREATE_FAILED',
              message: 'private provider cause',
              details: { handleCleanup, failureStateRecorded: false },
            },
          },
          { status: 502 },
        ),
      ),
    );
    const failure = await api.post('/sessions', {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as Error).message).toContain(expected);
    expect((failure as Error).message).not.toContain('private provider cause');
    expect(failure).toMatchObject({ details: { handleCleanup, failureStateRecorded: false } });
  });

  it('does not apply cleanup guidance to unrelated errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'private provider cause',
              details: { handleCleanup: 'ACTIVE_OWNED' },
            },
          },
          { status: 500 },
        ),
      ),
    );
    await expect(api.post('/sessions', {})).rejects.toMatchObject({
      message: '服务发生异常，请前往设置查看诊断信息。',
    });
  });
});

it.each([
  [{ handleCleanup: 'UNKNOWN' }, '本次新连接资源清理结果未知'],
  [
    { handleCleanup: 'HANDLE_CLOSE_RETURNED', previousHandleCleanup: 'UNKNOWN' },
    '旧连接资源清理结果未知',
  ],
  [
    { handleCleanup: 'UNKNOWN', previousHandleCleanup: 'UNKNOWN' },
    '旧连接及本次新连接资源清理结果未知',
  ],
  [{ handleCleanup: 'ACTIVE_OWNED' }, '现有会话仍由系统管理'],
] as const)('resume清理诊断仅显示安全文案 %j', async (details, message) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'AGENT_SESSION_RESUME_FAILED', message: 'private raw cause', details } },
          { status: 502 },
        ),
      ),
  );
  const failure = await api.post('/sessions/session/resume', {}).catch((error: unknown) => error);
  expect(failure).toMatchObject({ message: expect.stringContaining(message) });
  expect((failure as Error).message).not.toContain('private raw cause');
  expect((failure as Error).message).toContain('勿直接重复恢复');
});
