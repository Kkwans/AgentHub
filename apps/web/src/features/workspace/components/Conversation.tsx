import { AlertTriangle, Button, LoaderCircle, ShieldCheck, Wrench } from '@agenthub/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../../components/Common';
import type {
  ApprovalRecord,
  EventRecord,
  MessageRecord,
  RunRecord,
  SessionRecord,
} from '../../../lib/api';
import {
  labelAgentEventType,
  labelApprovalStatus,
  presentAgentMessage,
} from '../../../presentation/domain-labels';
import type { QueryState } from '../workspace-types';
import { RunStateBanner } from './RunStateBanner';

export function Conversation({
  session,
  messages,
  events,
  approvals,
  activeRun,
  latestRunStatus,
  onResolveApproval,
}: {
  session: SessionRecord;
  messages: QueryState<MessageRecord[]>;
  events: QueryState<EventRecord[]>;
  approvals: QueryState<ApprovalRecord[]>;
  activeRun: RunRecord | undefined;
  latestRunStatus?: string | undefined;
  onResolveApproval: (id: string, optionId: string) => Promise<ApprovalRecord>;
}) {
  const [approvalFeedback, setApprovalFeedback] = useState<string>();
  const [resolving, setResolving] = useState<string>();
  const [resolveError, setResolveError] = useState<Error>();
  const [resolveVariables, setResolveVariables] = useState<{ id: string; optionId: string }>();
  const resolveApproval = async (variables: { id: string; optionId: string }) => {
    setApprovalFeedback(undefined);
    setResolveError(undefined);
    setResolveVariables(variables);
    setResolving(variables.id);
    try {
      const approval = await onResolveApproval(variables.id, variables.optionId);
      setApprovalFeedback(
        approval.deliveryState === 'UNKNOWN'
          ? '决定已保存，但 Agent 是否收到仍无法确认。'
          : approval.deliveryState === 'DEAD'
            ? '决定已保存，但没有发送给 Agent。'
            : '决定已安全保存，正在确认 Agent 接收状态。',
      );
    } catch (error) {
      setResolveError(error instanceof Error ? error : new Error('Approval 提交失败。'));
    } finally {
      setResolving(undefined);
    }
  };
  const toolEvents = (events.data ?? []).filter(
    (event) =>
      event.payloadJson.ignored !== true &&
      (event.type.startsWith('tool.') || event.type === 'agent.plan.updated'),
  );
  const showEmpty =
    !messages.isLoading &&
    !events.isLoading &&
    !approvals.isLoading &&
    !messages.error &&
    !events.error &&
    !approvals.error &&
    !messages.data?.length &&
    !events.data?.length;
  return (
    <div className="conversation">
      <div className="panel-title conversation-title">
        <div>
          <span>对话与执行</span>
          <small>{activeRun ? '当前 Run' : '没有活动 Run'}</small>
        </div>
        {activeRun && <StatusBadge status={activeRun.status} />}
      </div>
      <div
        className="conversation-scroll"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <RunStateBanner
          sessionStatus={session.status}
          activeRunStatus={activeRun?.status}
          latestRunStatus={latestRunStatus}
        />
        {approvals.isLoading && <LoadingState label="正在读取 Approval" />}
        {approvals.error && (
          <ErrorState error={approvals.error} retry={() => approvals.refetch()} />
        )}
        {approvalFeedback && (
          <div className="workspace-query-status" role="status" aria-live="polite">
            {approvalFeedback}
          </div>
        )}
        {messages.isLoading && <LoadingState label="正在读取消息" />}
        {messages.error && <ErrorState error={messages.error} retry={() => messages.refetch()} />}
        {events.isLoading && <LoadingState label="正在读取工具事件" />}
        {events.error && <ErrorState error={events.error} retry={() => events.refetch()} />}
        {showEmpty && (
          <EmptyState
            title="等待第一条指令"
            description="Composer 会固定带上 Agent、Project、cwd、branch 与 PromptOS 上下文。"
          />
        )}
        {(messages.data ?? []).map((message) => {
          const presentation = presentAgentMessage(message.text);
          return (
            <article className={`message ${message.role.toLowerCase()}`} key={message.id}>
              <div className="message-meta">
                <span>
                  {message.role === 'USER'
                    ? '你'
                    : message.role === 'ASSISTANT'
                      ? 'Agent'
                      : message.role}
                </span>
                <code>#{message.sequence}</code>
              </div>
              {presentation.kind === 'TRANSPORT_ERROR' ? (
                <div className="message-body message-body-error">
                  <strong>{presentation.title}</strong>
                  <p>{presentation.text}</p>
                  <details className="message-debug">
                    <summary>显示脱敏诊断</summary>
                    <pre>{presentation.debug}</pre>
                  </details>
                </div>
              ) : (
                <div className="message-body">{presentation.text}</div>
              )}
            </article>
          );
        })}
        {toolEvents.length > 0 && (
          <Link className="tool-summary" to="?view=tools" aria-label="查看工具调用详情">
            <span className="tool-icon">
              <Wrench size={16} />
            </span>
            <span>
              <strong>执行摘要</strong>
              <small>
                {toolEvents.length} 个工具调用 · 最近：
              </small>
              <small className="tool-summary-latest">
                {labelAgentEventType(toolEvents.at(-1)?.type ?? '')}
              </small>
            </span>
              <span className="tool-summary-action">查看详情 →</span>
          </Link>
        )}
        {(approvals.data ?? []).map((approval) => {
          const awaitingDecision = approval.status === 'PENDING';
          const deliveryInProgress = ['QUEUED', 'CLAIMED', 'DISPATCHING', 'RETRY_WAIT'].includes(
            approval.deliveryState ?? '',
          );
          const deliveryUnconfirmed = approval.deliveryState === 'UNKNOWN';
          const deliveryAborted = approval.deliveryState === 'DEAD';
          const selectedOption = approval.optionsJson.find(
            (option) => option.id === approval.selectedOptionId,
          );
          const deliveryStateLabel =
            approval.deliveryState === 'UNKNOWN'
              ? '状态无法确认'
              : approval.deliveryState === 'DEAD'
                ? '未发送给 Agent'
                : approval.deliveryState === 'DELIVERED'
                  ? 'Agent 已接收'
                  : approval.deliveryState
                    ? '正在处理'
                    : '尚未发送';
          const deliveryFailureCopy =
            approval.deliveryState === 'UNKNOWN'
              ? 'Agent 没有在限定时间内确认，系统不会自动重发，避免同一权限操作执行两次。'
              : '系统未能将这个决定交给 Agent。请恢复 Session 后重新开始。';
          return (
            <article
              className={`approval-card${deliveryUnconfirmed || deliveryAborted ? ' approval-card-attention' : ''}`}
              key={approval.id}
            >
              <div className="approval-heading">
                <span>
                  {deliveryInProgress ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : deliveryUnconfirmed || deliveryAborted ? (
                    <AlertTriangle size={17} />
                  ) : (
                    <ShieldCheck size={17} />
                  )}
                </span>
                <div className="approval-heading-copy">
                  <small className="approval-kicker">
                    {awaitingDecision ? 'Agent 请求' : deliveryInProgress ? '正在处理' : '投递结果'}
                  </small>
                  <strong>{approval.title}</strong>
                </div>
              </div>
              {approval.description && (
                <div className="approval-impact">
                  <span>影响</span>
                  <p>{approval.description}</p>
                </div>
              )}
              {awaitingDecision && (
                <>
                  <span className="approval-options-label">可选操作</span>
                  {approval.optionsJson.some((option) => option.id) ? (
                    <div
                      className="approval-actions"
                      aria-label="合法操作选项"
                      aria-busy={resolving === approval.id}
                    >
                      {approval.optionsJson.map(
                        (option) =>
                          option.id && (
                            <Button
                              key={option.id}
                              color={
                                /reject|deny|refuse/i.test(
                                  `${option.kind ?? ''} ${option.id} ${option.label ?? ''}`,
                                )
                                  ? 'gray'
                                  : 'orange'
                              }
                              size="1"
                              variant={
                                /reject|deny|refuse/i.test(
                                  `${option.kind ?? ''} ${option.id} ${option.label ?? ''}`,
                                )
                                  ? 'soft'
                                  : 'solid'
                              }
                              onClick={() =>
                                void resolveApproval({ id: approval.id, optionId: option.id! })
                              }
                              disabled={Boolean(resolving)}
                            >
                              {option.label ?? option.id}
                            </Button>
                          ),
                      )}
                    </div>
                  ) : (
                    <div className="approval-no-options" role="alert">
                      Agent 没有提供可执行选项，请返回 Session 列表重新开始。
                    </div>
                  )}
                </>
              )}
              {deliveryInProgress && (
                <div className="approval-delivery-status" role="status" aria-live="polite">
                  <strong>决定已保存</strong>
                  <span>
                    已选择“{selectedOption?.label ?? '已记录选项'}”，正在等待 Agent
                    确认接收，请勿重复操作。
                  </span>
                </div>
              )}
              {deliveryUnconfirmed && (
                <div
                  className="approval-delivery-status approval-delivery-status-danger"
                  role="alert"
                >
                  <strong>无法确认 Agent 是否收到</strong>
                  <span>{deliveryFailureCopy}</span>
                  <Link to="/sessions">前往 Session 列表恢复或重新开始</Link>
                </div>
              )}
              {deliveryAborted && (
                <div
                  className="approval-delivery-status approval-delivery-status-danger"
                  role="alert"
                >
                  <strong>决定没有发送给 Agent</strong>
                  <span>{deliveryFailureCopy}</span>
                  <Link to="/sessions">前往 Session 列表处理</Link>
                </div>
              )}
              {resolveVariables?.id === approval.id && resolveError && (
                <div className="workspace-query-error" role="alert">
                  <span>{resolveError.message}</span>
                  {((resolveError as Error & { code?: string }).code ?? '') !==
                    'APPROVAL_DECISION_CONFLICT' && (
                    <Button
                      color="red"
                      size="1"
                      variant="soft"
                      disabled={Boolean(resolving)}
                      onClick={() => {
                        if (resolveVariables) void resolveApproval(resolveVariables);
                      }}
                    >
                      重试此选项
                    </Button>
                  )}
                </div>
              )}
              <details className="approval-debug">
                <summary>显示诊断信息</summary>
                <dl>
                  <div>
                    <dt>Approval</dt>
                    <dd>
                      <code>{approval.id}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{labelApprovalStatus(approval.status)}</dd>
                  </div>
                  <div>
                    <dt>投递</dt>
                    <dd>{deliveryStateLabel}</dd>
                  </div>
                  {approval.deliveryErrorCode && (
                    <div>
                      <dt>错误码</dt>
                      <dd>
                        <code>{approval.deliveryErrorCode}</code>
                      </dd>
                    </div>
                  )}
                  {approval.deliveryErrorMessage && (
                    <div>
                      <dt>原始信息</dt>
                      <dd>{approval.deliveryErrorMessage}</dd>
                    </div>
                  )}
                </dl>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  );
}
