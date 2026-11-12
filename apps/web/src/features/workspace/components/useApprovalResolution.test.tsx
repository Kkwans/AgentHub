// @vitest-environment jsdom
import { api } from '../../../lib/api';
import { act, cleanup, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { authSession } from '../../../lib/auth-api';
import type { ApprovalRecord } from '../../../lib/api';
import { useApprovalResolution } from './useApprovalResolution';
const auth = vi.hoisted(() => ({ mode: 'local_trusted', user: null as { id: string } | null }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => auth.mode,
  useAuthUser: () => auth.user,
}));
beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  auth.mode = 'local_trusted';
  auth.user = null;
});
const pending: ApprovalRecord = {
  id: 'approval-a',
  sessionId: 'session-a',
  runId: 'run-a',
  title: '允许测试操作',
  description: null,
  status: 'PENDING',
  optionsJson: [{ id: 'allow', label: '允许一次', kind: 'allow_once' }],
  selectedOptionId: null,
  deliveryId: null,
  deliveryState: null,
  deliveryAttemptCount: null,
  deliveryErrorCode: null,
  deliveryErrorMessage: null,
};
function decided(state: ApprovalRecord['deliveryState']): ApprovalRecord {
  return {
    ...pending,
    status: 'APPROVED',
    selectedOptionId: 'allow',
    deliveryId: 'delivery-a',
    deliveryState: state,
    deliveryAttemptCount: 1,
  };
}
function deferred() {
  let resolve!: (value: ApprovalRecord) => void;
  const promise = new Promise<ApprovalRecord>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const variables = { id: pending.id, optionId: 'allow' };
function mount(
  submit: (id: string, optionId: string) => Promise<ApprovalRecord> = vi.fn(async () =>
    decided('QUEUED'),
  ),
) {
  const hook = renderHook(
    ({ sessionId, approvals }) => useApprovalResolution(sessionId, approvals, submit),
    { initialProps: { sessionId: pending.sessionId, approvals: [pending] } },
  );
  return { ...hook, submit };
}
it.each([
  ['QUEUED', '等待投递', 'pending'],
  ['RETRY_WAIT', '等待投递', 'pending'],
  ['CLAIMED', '正在确认', 'pending'],
  ['DISPATCHING', '正在确认', 'pending'],
  ['DELIVERED', 'Agent 已确认接收', 'confirmed'],
  ['UNKNOWN', '无法确认', 'attention'],
  ['DEAD', '没有发送给 Agent', 'attention'],
  [null, '投递状态尚未确认', 'attention'],
] as const)('POST权威状态%s明确映射', async (state, copy, tone) => {
  const h = mount(vi.fn(async () => decided(state)));
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  expect(h.result.current.approvalFeedback).toMatchObject({
    message: expect.stringContaining(copy),
    tone,
  });
});
it('POST直接DELIVERED不被旧QUERY QUEUED倒退，后续旧query也不回退', async () => {
  const response = deferred();
  const h = mount(vi.fn(() => response.promise));
  let wait!: Promise<void>;
  act(() => {
    wait = h.result.current.resolveApproval(variables);
  });
  h.rerender({ sessionId: pending.sessionId, approvals: [decided('QUEUED')] });
  await act(async () => {
    response.resolve(decided('DELIVERED'));
    await wait;
  });
  expect(h.result.current.approvalFeedback?.tone).toBe('confirmed');
  h.rerender({ sessionId: pending.sessionId, approvals: [decided('DISPATCHING')] });
  expect(h.result.current.approvalFeedback?.tone).toBe('confirmed');
});
it('POST QUEUED随匹配QUERY DELIVERED更新，不依赖Run状态', async () => {
  const h = mount();
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  h.rerender({ sessionId: pending.sessionId, approvals: [decided('DELIVERED')] });
  expect(h.result.current.approvalFeedback?.tone).toBe('confirmed');
});
it.each(['UNKNOWN', 'DEAD'] as const)('同delivery终态冲突DELIVERED/%s明确未知', async (state) => {
  const h = mount(vi.fn(async () => decided('DELIVERED')));
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  h.rerender({ sessionId: pending.sessionId, approvals: [decided(state)] });
  expect(h.result.current.approvalFeedback).toMatchObject({
    tone: 'attention',
    message: expect.stringContaining('投递记录不一致'),
  });
});
it.each(['option', 'delivery', 'session', 'run'] as const)(
  '不同%s查询不套用本次决定',
  async (mismatch) => {
    const h = mount();
    await act(async () => {
      await h.result.current.resolveApproval(variables);
    });
    const other = {
      ...decided('DELIVERED'),
      ...(mismatch === 'option'
        ? { selectedOptionId: 'deny' }
        : mismatch === 'delivery'
          ? { deliveryId: 'other' }
          : mismatch === 'session'
            ? { sessionId: 'other' }
            : { runId: 'other' }),
    };
    h.rerender({ sessionId: pending.sessionId, approvals: [other] });
    expect(h.result.current.approvalFeedback?.tone).toBe('pending');
  },
);
it.each(['session', 'account', 'authorization', 'unmount'] as const)(
  '%s变更后旧返回不能显示反馈',
  async (change) => {
    const response = deferred();
    const h = mount(vi.fn(() => response.promise));
    let wait!: Promise<void>;
    act(() => {
      wait = h.result.current.resolveApproval(variables);
    });
    if (change === 'session') h.rerender({ sessionId: 'session-b', approvals: [] });
    if (change === 'account') {
      auth.mode = 'token';
      auth.user = { id: 'account-b' };
      h.rerender({ sessionId: pending.sessionId, approvals: [pending] });
    }
    if (change === 'authorization') act(() => authSession.notifyAuthorizationRequired());
    if (change === 'unmount') h.unmount();
    await act(async () => {
      response.resolve(decided('DELIVERED'));
      await wait;
    });
    if (change !== 'unmount') expect(h.result.current.approvalFeedback).toBeUndefined();
  },
);
it('旧决定响应与finally不覆盖较新的决定', async () => {
  const first = deferred(),
    second = deferred();
  const submit = vi.fn((id: string) => (id === pending.id ? first.promise : second.promise));
  const h = mount(submit);
  const next = { ...pending, id: 'approval-b' };
  h.rerender({ sessionId: pending.sessionId, approvals: [pending, next] });
  let a!: Promise<void>, b!: Promise<void>;
  act(() => {
    a = h.result.current.resolveApproval(variables);
    b = h.result.current.resolveApproval({ id: next.id, optionId: 'allow' });
  });
  await act(async () => {
    second.resolve({ ...decided('UNKNOWN'), id: next.id, deliveryId: 'delivery-b' });
    await b;
  });
  await act(async () => {
    first.resolve(decided('DELIVERED'));
    await a;
  });
  expect(h.result.current.approvalFeedback?.tone).toBe('attention');
  expect(h.result.current.resolveVariables?.id).toBe(next.id);
});
it('同一Approval双击只有一次请求，授权撤销后导航也不能复活旧回调', async () => {
  const response = deferred();
  const h = mount(vi.fn(() => response.promise));
  let wait!: Promise<void>;
  act(() => {
    wait = h.result.current.resolveApproval(variables);
    void h.result.current.resolveApproval(variables);
  });
  expect(h.submit).toHaveBeenCalledTimes(1);
  act(() => authSession.notifyAuthorizationRequired());
  h.rerender({ sessionId: 'session-b', approvals: [{ ...pending, sessionId: 'session-b' }] });
  await act(async () => {
    await h.result.current.resolveApproval(variables);
    response.resolve(decided('DELIVERED'));
    await wait;
  });
  expect(h.submit).toHaveBeenCalledTimes(1);
});

it.each([null, undefined])('异常POST返回%s只提示身份无法确认', async (value) => {
  const h = mount(vi.fn(async () => value as unknown as ApprovalRecord));
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  expect(h.result.current.resolveError?.message).toContain('返回身份无法确认');
  expect(h.result.current.approvalFeedback).toBeUndefined();
});

it.each(['DELIVERED', 'UNKNOWN', 'DEAD'] as const)(
  'pending列表消失后单条GET确认%s，终态停查无POST',
  async (state) => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue(decided(state));
    const h = mount();
    await act(async () => {
      await h.result.current.resolveApproval(variables);
    });
    h.rerender({ sessionId: pending.sessionId, approvals: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/approvals/approval-a', {
      signal: expect.any(AbortSignal),
    });
    expect(h.result.current.approvalFeedback?.tone).toBe(
      state === 'DELIVERED' ? 'confirmed' : 'attention',
    );
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.result.current.resolveError).toBeUndefined();
  },
);
it('单条读取失败仅提供只读重试，不走重新决定', async () => {
  vi.mocked(api.get)
    .mockRejectedValueOnce(new Error('read failed'))
    .mockResolvedValueOnce(decided('DELIVERED'));
  const h = mount();
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  expect(h.result.current.deliveryReadError).toContain('无法核验');
  expect(h.result.current.resolveError).toBeUndefined();
  await act(async () => {
    h.result.current.retryDeliveryRead();
  });
  expect(h.result.current.approvalFeedback?.tone).toBe('confirmed');
  expect(h.submit).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledTimes(2);
});
it.each(['session', 'auth', 'decision'] as const)(
  '单条GET在%s变化后取消并忽略迟到结果',
  async (change) => {
    const query = deferred();
    vi.mocked(api.get).mockReturnValueOnce(query.promise as never);
    const h = mount();
    await act(async () => {
      await h.result.current.resolveApproval(variables);
    });
    const signal = vi.mocked(api.get).mock.calls[0]?.[1]?.signal;
    if (change === 'session') h.rerender({ sessionId: 'session-b', approvals: [] });
    if (change === 'auth') act(() => authSession.notifyAuthorizationRequired());
    if (change === 'decision') {
      const next = { ...pending, id: 'approval-b' };
      h.rerender({ sessionId: pending.sessionId, approvals: [next] });
      await act(async () => {
        await h.result.current.resolveApproval({ id: next.id, optionId: 'allow' });
      });
    }
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      query.resolve(decided('DELIVERED'));
    });
    expect(h.result.current.approvalFeedback?.tone).not.toBe('confirmed');
  },
);
it.each(['sessionId', 'runId', 'selectedOptionId', 'deliveryId'] as const)(
  '单条GET错误%s不可借用确认',
  async (field) => {
    vi.mocked(api.get).mockResolvedValue({ ...decided('DELIVERED'), [field]: 'wrong' });
    const h = mount();
    await act(async () => {
      await h.result.current.resolveApproval(variables);
    });
    expect(h.result.current.deliveryReadError).toContain('无法核验');
    expect(h.result.current.approvalFeedback?.tone).toBe('attention');
    expect(h.result.current.resolveError).toBeUndefined();
  },
);
it('单条GET挂起10秒后取消，停止自动查询而非重发决定', async () => {
  vi.useFakeTimers();
  const h = mount();
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  const signal = vi.mocked(api.get).mock.calls[0]?.[1]?.signal;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(signal?.aborted).toBe(true);
  expect(h.result.current.deliveryReadError).toContain('无法核验');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90_000);
  });
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it('非终态最多20次单条读取，预算耗尽只读重试', async () => {
  vi.useFakeTimers();
  vi.mocked(api.get).mockResolvedValue(decided('DISPATCHING'));
  const h = mount();
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90_000);
  });
  expect(api.get).toHaveBeenCalledTimes(20);
  expect(h.result.current.deliveryReadError).toContain('无法核验');
  expect(h.submit).toHaveBeenCalledTimes(1);
});

it('真实异步POST pending已渲染后返回，列表清空仍启动单条GET', async () => {
  const response = deferred();
  vi.mocked(api.get).mockResolvedValue(decided('DELIVERED'));
  const h = mount(vi.fn(() => response.promise));
  let wait!: Promise<void>;
  act(() => {
    wait = h.result.current.resolveApproval(variables);
  });
  expect(h.result.current.resolving).toBe(pending.id);
  expect(api.get).not.toHaveBeenCalled();
  h.rerender({ sessionId: pending.sessionId, approvals: [] });
  await act(async () => {
    response.resolve(decided('DISPATCHING'));
    await wait;
  });
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(h.result.current.approvalFeedback?.tone).toBe('confirmed');
});
it('每次GET耗时9秒也在60秒总预算截止，而非20乘10秒', async () => {
  vi.useFakeTimers();
  vi.mocked(api.get).mockImplementation(
    () =>
      new Promise((resolve) => setTimeout(() => resolve(decided('DISPATCHING') as never), 9_000)),
  );
  const h = mount();
  await act(async () => {
    await h.result.current.resolveApproval(variables);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(h.result.current.deliveryReadError).toContain('无法核验');
  const count = vi.mocked(api.get).mock.calls.length;
  expect(count).toBeLessThanOrEqual(6);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(api.get).toHaveBeenCalledTimes(count);
  expect(h.submit).toHaveBeenCalledTimes(1);
});

it.each(['APPROVED', 'REJECTED'] as const)(
  '单条GET决定status不得改变已冻结的%s',
  async (status) => {
    vi.mocked(api.get).mockResolvedValue({
      ...decided('DELIVERED'),
      status: status === 'APPROVED' ? 'REJECTED' : 'APPROVED',
    });
    const h = mount(vi.fn(async () => ({ ...decided('QUEUED'), status })));
    await act(async () => {
      await h.result.current.resolveApproval(variables);
    });
    expect(h.result.current.deliveryReadError).toContain('无法核验');
    expect(h.result.current.approvalFeedback?.tone).toBe('attention');
    expect(h.result.current.resolveError).toBeUndefined();
    expect(h.submit).toHaveBeenCalledTimes(1);
  },
);
it.each(['APPROVED', 'REJECTED'] as const)(
  '列表观察不得采用与已冻结%s相反的决定status',
  async (status) => {
    const h = mount(vi.fn(async () => ({ ...decided('QUEUED'), status })));
    await act(async () => {
      await h.result.current.resolveApproval(variables);
    });
    h.rerender({
      sessionId: pending.sessionId,
      approvals: [
        { ...decided('DELIVERED'), status: status === 'APPROVED' ? 'REJECTED' : 'APPROVED' },
      ],
    });
    expect(h.result.current.approvalFeedback?.tone).toBe('pending');
    expect(h.result.current.approvalFeedback?.message).toContain('等待投递');
    expect(h.submit).toHaveBeenCalledTimes(1);
  },
);
