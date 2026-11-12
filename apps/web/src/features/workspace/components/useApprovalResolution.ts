import { useEffect, useRef, useState } from 'react';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api, authSession, type ApprovalRecord } from '../../../lib/api';
import {
  approvalDeliveryPresentation,
  mergeDeliveryObservation,
  type DeliveryObservation,
} from '../lib/approval-delivery';

type Variables = { id: string; optionId: string };
type Resolution = {
  identity: string;
  sequence: number;
  variables: Variables;
  pending: boolean;
  error?: Error;
  observation?: DeliveryObservation;
  readError?: string | undefined;
  checking?: boolean;
};
export function useApprovalResolution(
  sessionId: string,
  approvals: ApprovalRecord[] | undefined,
  submit: (id: string, optionId: string) => Promise<ApprovalRecord>,
) {
  const mode = useAuthMode(),
    user = useAuthUser();
  const scope =
    mode === 'local_trusted'
      ? 'local-trusted'
      : mode === 'token' && user?.id
        ? `account:${user.id}`
        : null;
  const identity = `${scope ?? 'unavailable'}:${sessionId}`;
  const owner = useRef(identity),
    sequence = useRef(0),
    mounted = useRef(true),
    revoked = useRef(false);
  if (owner.current !== identity) {
    owner.current = identity;
    sequence.current += 1;
  }
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) {
    previousScope.current = scope;
    revoked.current = false;
  }
  const latestApprovals = useRef(approvals);
  latestApprovals.current = approvals;
  const inFlight = useRef(new Set<string>());
  const [resolution, setResolution] = useState<Resolution>();
  const [, redraw] = useState(0);
  const [readAttempt, retryRead] = useState(0);
  const activeRead = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    const stop = authSession.onAuthorizationRequired(() => {
      revoked.current = true;
      sequence.current += 1;
      redraw((value) => value + 1);
    });
    return () => {
      mounted.current = false;
      sequence.current += 1;
      stop();
    };
  }, []);
  useEffect(() => {
    if (revoked.current || !mounted.current) return;
    setResolution((current) => {
      if (
        !current?.observation ||
        current.identity !== identity ||
        current.sequence !== sequence.current
      )
        return current;
      const next = approvals?.find(
        (approval) => approval.id === current.variables.id && approval.sessionId === sessionId,
      );
      if (!next) return current;
      const observation = mergeDeliveryObservation(current.observation, next);
      return observation === current.observation ? current : { ...current, observation };
    });
  }, [approvals, identity, sessionId]);
  const resolve = async (variables: Variables) => {
    const key = `${identity}:${variables.id}`;
    if (
      !scope ||
      revoked.current ||
      !mounted.current ||
      owner.current !== identity ||
      inFlight.current.has(key)
    )
      return;
    // The decision must belong to the currently displayed Session, not a stale renderer callback.
    const requested = latestApprovals.current?.find(
      (approval) => approval.id === variables.id && approval.sessionId === sessionId,
    );
    if (!requested || !requested.optionsJson.some((option) => option.id === variables.optionId))
      return;
    const operation = ++sequence.current;
    const live = () =>
      mounted.current &&
      !revoked.current &&
      owner.current === identity &&
      sequence.current === operation;
    inFlight.current.add(key);
    setResolution({ identity, sequence: operation, variables, pending: true });
    try {
      const approval = await submit(variables.id, variables.optionId);
      if (!live()) return;
      if (!approval || typeof approval !== 'object')
        throw new Error('Approval 返回身份无法确认，请刷新核对。');
      if (
        approval.id !== variables.id ||
        approval.sessionId !== sessionId ||
        approval.runId !== requested.runId ||
        approval.selectedOptionId !== variables.optionId ||
        !['APPROVED', 'REJECTED'].includes(approval.status) ||
        (approval.deliveryState !== null && !approval.deliveryId)
      )
        throw new Error('Approval 返回身份或决定不一致，请刷新核对。');
      let observation: DeliveryObservation = { approval, conflict: false };
      const query = latestApprovals.current?.find(
        (row) => row.id === approval.id && row.sessionId === sessionId,
      );
      if (query) observation = mergeDeliveryObservation(observation, query);
      setResolution({ identity, sequence: operation, variables, pending: false, observation });
    } catch (error) {
      if (live())
        setResolution({
          identity,
          sequence: operation,
          variables,
          pending: false,
          error: error instanceof Error ? error : new Error('Approval 提交结果无法确认。'),
        });
    } finally {
      inFlight.current.delete(key);
    }
  };
  const current =
    !revoked.current &&
    resolution?.identity === identity &&
    resolution.sequence === sequence.current
      ? resolution
      : undefined;

  const terminalReceipt = Boolean(
    current?.observation &&
    (current.observation.conflict ||
      ['DELIVERED', 'UNKNOWN', 'DEAD'].includes(current.observation.approval.deliveryState ?? '')),
  );
  const receipt = current?.observation?.approval;
  const receiptOperation = current?.sequence;
  useEffect(() => {
    if (!receipt || terminalReceipt || receiptOperation === undefined || revoked.current || !scope)
      return;
    const frozen = receipt;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let count = 0;
    const live = () =>
      !stopped &&
      mounted.current &&
      !revoked.current &&
      owner.current === identity &&
      sequence.current === receiptOperation;
    const change = (update: (value: Resolution) => Resolution) => {
      if (live())
        setResolution((value) =>
          value?.identity === identity && value.sequence === receiptOperation
            ? update(value)
            : value,
        );
    };
    const failure = () =>
      change((value) => ({
        ...value,
        checking: false,
        readError: '决定已保存，但无法核验 Agent 接收状态。可重新查询；不会重新提交决定。',
      }));
    const stopRead = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (requestTimer) clearTimeout(requestTimer);
      controller?.abort();
      if (activeRead.current === controller) activeRead.current = undefined;
    };
    const deadline = setTimeout(() => {
      if (live()) failure();
      stopRead();
    }, 60_000);
    const query = async () => {
      if (!live()) return;
      if (count++ >= 20) {
        failure();
        return;
      }
      controller = new AbortController();
      activeRead.current = controller;
      change((value) => ({ ...value, checking: true, readError: undefined }));
      requestTimer = setTimeout(() => {
        if (live()) failure();
        controller?.abort();
        stopped = true;
        if (activeRead.current === controller) activeRead.current = undefined;
      }, 10_000);
      try {
        const result = await api.get<ApprovalRecord>(
          '/approvals/' + encodeURIComponent(frozen.id),
          { signal: controller.signal },
        );
        if (!live()) return;
        if (
          !result ||
          typeof result !== 'object' ||
          result.id !== frozen.id ||
          result.sessionId !== frozen.sessionId ||
          result.runId !== frozen.runId ||
          result.selectedOptionId !== frozen.selectedOptionId ||
          result.deliveryId !== frozen.deliveryId ||
          result.status !== frozen.status ||
          ![
            null,
            'QUEUED',
            'CLAIMED',
            'DISPATCHING',
            'RETRY_WAIT',
            'DELIVERED',
            'UNKNOWN',
            'DEAD',
          ].includes(result.deliveryState) ||
          (result.deliveryState !== null && !result.deliveryId)
        )
          throw new Error('receipt identity mismatch');
        change((value) =>
          value.observation
            ? {
                ...value,
                checking: false,
                readError: undefined,
                observation: mergeDeliveryObservation(value.observation, result),
              }
            : value,
        );
        if (!['DELIVERED', 'UNKNOWN', 'DEAD'].includes(result.deliveryState ?? ''))
          timer = setTimeout(() => void query(), 3_000);
      } catch {
        if (live()) failure();
      } finally {
        if (requestTimer) clearTimeout(requestTimer);
        if (activeRead.current === controller) activeRead.current = undefined;
      }
    };
    void query();
    return () => {
      clearTimeout(deadline);
      stopRead();
    };
    // Receipt identity is immutable for this decision; updates must not reset the polling budget.
  }, [
    identity,
    receiptOperation,
    receipt?.id,
    receipt?.deliveryId,
    terminalReceipt,
    readAttempt,
    scope,
  ]);
  const retryDeliveryRead = () => {
    if (
      !mounted.current ||
      revoked.current ||
      owner.current !== identity ||
      !current?.readError ||
      current.sequence !== sequence.current ||
      activeRead.current !== undefined ||
      current.checking ||
      terminalReceipt
    )
      return;
    retryRead((attempt) => attempt + 1);
  };
  const feedback =
    current?.readError && !terminalReceipt
      ? { message: current.readError, tone: 'attention' as const }
      : current?.observation
        ? current.observation.conflict
          ? {
              message: '投递记录不一致，无法确认 Agent 是否收到。请刷新核对；不会自动重发。',
              tone: 'attention' as const,
            }
          : approvalDeliveryPresentation(current.observation.approval.deliveryState)
        : undefined;
  return {
    resolveApproval: resolve,
    retryDeliveryRead,
    deliveryReadError: terminalReceipt ? undefined : current?.readError,
    deliveryChecking: current?.checking ?? false,
    approvalFeedback: feedback,
    resolving: current?.pending ? current.variables.id : undefined,
    resolveError: current?.error,
    resolveVariables: current?.variables,
  };
}
