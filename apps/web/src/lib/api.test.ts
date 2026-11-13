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

describe('Task Prompt recovery error contract', () => {
  it.each([
    ['TASK_PROMPT_VARIABLES_MISSING', '任务 Prompt 缺少必填变量，尚未启动 Agent', 'post'],
    [
      'TASK_PROMPT_VARIABLES_LOCKED',
      '任务已开始或状态已变化，无法修改变量。请刷新查看原任务。',
      'patch',
    ],
    ['TASK_PROMPT_RESOLUTION_FAILED', '任务 Prompt 无法解析，请核对绑定与版本后重试。', 'post'],
  ] as const)('preserves actionable safe guidance for %s', async (code, message, method) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code,
              message: 'private provider cause /secret/path',
              details: { missingVariables: ['subject'] },
            },
          },
          { status: 409 },
        ),
      ),
    );
    const failure = await api[method](
      method === 'patch' ? '/tasks/current' : '/tasks/current/start',
      {},
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code,
      status: 409,
      message,
      details: { missingVariables: ['subject'] },
    });
    expect((failure as Error).message).not.toContain('private provider');
    expect((failure as Error).message).not.toContain('/secret/path');
  });
  it('keeps unknown Task errors generic instead of forwarding server text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'TASK_PROMPT_UNKNOWN_PROVIDER_FAILURE',
              message: 'private provider cause /secret/path',
            },
          },
          { status: 409 },
        ),
      ),
    );
    const failure = await api.get('/tasks/current').catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'TASK_PROMPT_UNKNOWN_PROVIDER_FAILURE',
      status: 409,
      message: '请求失败，请查看设置中的诊断信息。',
    });
  });
});

it('隔离任务Session直发被拒绝时指向受管返工，不泄漏后端细节或自动重发', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        error: {
          code: 'WORKTREE_RUN_ADMISSION_REJECTED',
          message: 'private identity mismatch /secret/worktree',
        },
      },
      { status: 409 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const failure = await api
    .post('/sessions/session-a/messages', { text: '继续修改' })
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({
    code: 'WORKTREE_RUN_ADMISSION_REJECTED',
    status: 409,
    message: '该会话由隔离执行管理，请回到任务使用隔离返工或核对执行状态。',
  });
  expect((failure as Error).message).not.toContain('/secret/worktree');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  'TASK_START_UNRESOLVED',
  'TASK_SESSION_CREATE_UNKNOWN',
  'TASK_RUN_OWNERSHIP_CHANGED',
  'TASK_START_RESERVATION_UNCONFIRMED',
])('%s明确核对原尝试，不暴露后端原文或自动重发', async (code) => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        error: {
          code,
          message: 'secret provider /private/path',
          details: { attemptId: 'attempt-a', sessionId: 'session-a' },
        },
      },
      {
        status:
          code === 'TASK_SESSION_CREATE_UNKNOWN'
            ? 502
            : code === 'TASK_START_RESERVATION_UNCONFIRMED'
              ? 503
              : 409,
      },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const failure = await api.post('/tasks/task-a/start', {}).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({
    code,
    details: { attemptId: 'attempt-a', sessionId: 'session-a' },
  });
  expect((failure as Error).message).toContain('核对');
  expect((failure as Error).message).not.toContain('/private/path');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('Git状态失败显示可操作说明而不是clean或底层错误', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'GIT_STATUS_FAILED', message: 'internal path must not render' } },
          { status: 409 },
        ),
      ),
  );
  await expect(api.get('/projects/p/git/status')).rejects.toMatchObject({
    code: 'GIT_STATUS_FAILED',
    status: 409,
    message: 'Git 状态读取失败，是否干净尚未确认。请检查仓库是否可访问后重新读取。',
  });
});
