import type { ApprovalRecord } from '../../../lib/api';

export function approvalDeliveryPresentation(state: ApprovalRecord['deliveryState']) {
  switch (state) {
    case 'DELIVERED':
      return {
        label: 'Agent 已接收',
        message: '决定已保存，Agent 已确认接收。',
        tone: 'confirmed' as const,
      };
    case 'UNKNOWN':
      return {
        label: '状态无法确认',
        message: '决定已保存，但 Agent 是否收到仍无法确认。系统不会自动重发。',
        tone: 'attention' as const,
      };
    case 'DEAD':
      return {
        label: '未发送给 Agent',
        message: '决定已保存，但没有发送给 Agent。',
        tone: 'attention' as const,
      };
    case 'QUEUED':
    case 'RETRY_WAIT':
      return {
        label: '等待投递',
        message: '决定已保存，正在等待投递；尚未确认 Agent 接收。',
        tone: 'pending' as const,
      };
    case 'CLAIMED':
    case 'DISPATCHING':
      return {
        label: '正在处理',
        message: '决定已保存，正在确认 Agent 接收状态。',
        tone: 'pending' as const,
      };
    default:
      return {
        label: '投递状态未确认',
        message: '决定已保存，但投递状态尚未确认。',
        tone: 'attention' as const,
      };
  }
}
export type DeliveryObservation = { approval: ApprovalRecord; conflict: boolean };
const terminal = new Set(['DELIVERED', 'UNKNOWN', 'DEAD']);
export function mergeDeliveryObservation(
  current: DeliveryObservation,
  next: ApprovalRecord,
): DeliveryObservation {
  const previous = current.approval;
  if (
    current.conflict ||
    !['APPROVED', 'REJECTED'].includes(next.status) ||
    previous.status !== next.status ||
    (next.deliveryState !== null && !next.deliveryId) ||
    previous.id !== next.id ||
    previous.sessionId !== next.sessionId ||
    previous.runId !== next.runId ||
    previous.selectedOptionId !== next.selectedOptionId ||
    previous.deliveryId !== next.deliveryId
  )
    return current;
  const oldTerminal = terminal.has(previous.deliveryState ?? '');
  const newTerminal = terminal.has(next.deliveryState ?? '');
  if (oldTerminal) {
    if (newTerminal && previous.deliveryState !== next.deliveryState)
      return { ...current, conflict: true };
    return current;
  }
  if (!newTerminal && (next.deliveryAttemptCount ?? 0) < (previous.deliveryAttemptCount ?? 0))
    return current;
  if (
    previous.deliveryState === next.deliveryState &&
    previous.deliveryAttemptCount === next.deliveryAttemptCount
  )
    return current;
  return { approval: next, conflict: false };
}
