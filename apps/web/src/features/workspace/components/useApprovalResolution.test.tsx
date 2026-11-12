// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { authSession } from '../../../lib/auth-api';
import type { ApprovalRecord } from '../../../lib/api';
import { useApprovalResolution } from './useApprovalResolution';
const auth = vi.hoisted(() => ({ mode: 'local_trusted', user: null as { id: string } | null }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => auth.mode,
  useAuthUser: () => auth.user,
}));
afterEach(() => {
  cleanup();
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
