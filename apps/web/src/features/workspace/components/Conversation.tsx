import {
  AlertTriangle,
  Button,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Wrench,
} from '@agenthub/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../../components/Common';
import type {
  ApprovalRecord,
  EventRecord,
  MessageRecord,
  RunRecord,
  SessionContinuationRecord,
  SessionRecord,
} from '../../../lib/api';
import {
  labelAgentEventType,
  labelApprovalStatus,
  presentAgentMessage,
} from '../../../presentation/domain-labels';
import type { MessageQueryState, QueryState } from '../workspace-types';
import { RunStateBanner } from './RunStateBanner';

const MarkdownMessage = lazy(() => import('./MarkdownMessage'));

type ConversationTimelineItem =
  | { kind: 'message'; id: string; createdAt: string; message: MessageRecord }
  | { kind: 'tool'; id: string; createdAt: string; event: EventRecord }
  | {
      kind: 'thought';
      id: string;
      createdAt: string;
      updatedAt: string;
      runId: string | null;
      firstSeq: number;
      text: string;
    };

export function buildConversationTimeline(
  messages: MessageRecord[],
  events: EventRecord[],
): ConversationTimelineItem[] {
  const toolItems = new Map<string, ConversationTimelineItem & { kind: 'tool' }>();
  const thoughtItems = new Map<string, ConversationTimelineItem & { kind: 'thought' }>();
  for (const event of events) {
    if (event.payloadJson.ignored === true) continue;
    if (event.type === 'agent.thought.delta') {
      const messageId =
        typeof event.payloadJson.messageId === 'string' ? event.payloadJson.messageId : undefined;
      const timelineId = `thought:${event.runId ?? event.sessionId}:${messageId ?? 'default'}`;
      const previous = thoughtItems.get(timelineId);
      const text = typeof event.payloadJson.text === 'string' ? event.payloadJson.text : '';
      thoughtItems.set(
        timelineId,
        previous
          ? { ...previous, updatedAt: event.createdAt, text: `${previous.text}${text}` }
          : {
              kind: 'thought',
              id: timelineId,
              createdAt: event.createdAt,
              updatedAt: event.createdAt,
              runId: event.runId,
              firstSeq: event.seq,
              text,
            },
      );
      continue;
    }
    if (!event.type.startsWith('tool.') && event.type !== 'agent.plan.updated') {
      continue;
    }
    const toolCallId =
      event.type.startsWith('tool.') && typeof event.payloadJson.toolCallId === 'string'
        ? event.payloadJson.toolCallId
        : undefined;
    const timelineId = toolCallId ? `tool:${toolCallId}` : `event:${event.id}`;
    const previous = toolItems.get(timelineId);
    if (!previous) {
      toolItems.set(timelineId, {
        kind: 'tool',
        id: timelineId,
        createdAt: event.createdAt,
        event,
      });
      continue;
    }
    toolItems.set(timelineId, {
      ...previous,
      event: {
        ...event,
        id: previous.event.id,
        seq: Math.min(previous.event.seq, event.seq),
        createdAt: previous.createdAt,
        payloadJson: { ...previous.event.payloadJson, ...event.payloadJson },
      },
    });
  }
  const items: ConversationTimelineItem[] = [
    ...messages.map((message) => ({
      kind: 'message' as const,
      id: message.id,
      createdAt: message.createdAt,
      message,
    })),
    ...toolItems.values(),
    ...thoughtItems.values(),
  ];
  return items.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    const byTime =
      (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);
    if (byTime !== 0) return byTime;
    const leftOrder =
      left.kind === 'message'
        ? left.message.sequence
        : left.kind === 'thought'
          ? left.firstSeq
          : left.event.seq;
    const rightOrder =
      right.kind === 'message'
        ? right.message.sequence
        : right.kind === 'thought'
          ? right.firstSeq
          : right.event.seq;
    return leftOrder - rightOrder;
  });
}

export function Conversation({
  session,
  messages,
  events,
  approvals,
  activeRun,
  latestRunStatus,
  continuation,
  continuePending,
  continueError,
  onContinue,
  onResolveApproval,
  hasPreviousMessages,
  isLoadingPreviousMessages,
  onLoadPreviousMessages,
}: {
  session: SessionRecord;
  messages: MessageQueryState;
  events: QueryState<EventRecord[]>;
  approvals: QueryState<ApprovalRecord[]>;
  activeRun: RunRecord | undefined;
  latestRunStatus?: string | undefined;
  continuation: SessionContinuationRecord | undefined;
  continuePending: boolean;
  continueError: Error | null;
  onContinue: () => void;
  onResolveApproval: (id: string, optionId: string) => Promise<ApprovalRecord>;
  hasPreviousMessages?: boolean;
  isLoadingPreviousMessages?: boolean;
  onLoadPreviousMessages?: () => Promise<unknown>;
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
  const timeline = buildConversationTimeline(messages.data ?? [], events.data ?? []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followTimelineRef = useRef(true);
  const loadingPreviousRef = useRef(false);
  const latestTimelineId = timeline.at(-1)?.id;
  const activeThoughtId = activeRun
    ? [...timeline].reverse().find((item) => item.kind === 'thought' && item.runId === activeRun.id)
        ?.id
    : undefined;
  useEffect(() => {
    if (!followTimelineRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [latestTimelineId]);
  const loadPreviousMessages = async () => {
    if (
      !hasPreviousMessages ||
      !onLoadPreviousMessages ||
      loadingPreviousRef.current ||
      isLoadingPreviousMessages
    )
      return;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    loadingPreviousRef.current = true;
    try {
      await onLoadPreviousMessages();
      requestAnimationFrame(() => {
        const current = scrollRef.current;
        if (current) current.scrollTop = current.scrollHeight - previousHeight + previousTop;
      });
    } finally {
      loadingPreviousRef.current = false;
    }
  };
  const showEmpty =
    !messages.isLoading &&
    !events.isLoading &&
    !approvals.isLoading &&
    !messages.error &&
    !events.error &&
    !approvals.error &&
    timeline.length === 0;
  return (
    <div className="conversation">
      <div className="panel-title conversation-title">
        <div>
          <span>对话</span>
          <small>{activeRun ? 'Agent 正在处理当前指令' : '消息与执行记录'}</small>
        </div>
        {activeRun && <StatusBadge status={activeRun.status} />}
      </div>
      <div
        ref={scrollRef}
        className="conversation-scroll"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(event) => {
          const element = event.currentTarget;
          followTimelineRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 120;
          if (element.scrollTop < 80) void loadPreviousMessages();
        }}
      >
        {(hasPreviousMessages || isLoadingPreviousMessages) && (
          <div className="conversation-history-control">
            <button
              type="button"
              onClick={() => void loadPreviousMessages()}
              disabled={Boolean(isLoadingPreviousMessages)}
              aria-label="加载更早消息"
            >
              {isLoadingPreviousMessages ? '正在加载更早消息…' : '加载更早消息'}
            </button>
          </div>
        )}
        <RunStateBanner
          sessionStatus={session.status}
          activeRunStatus={activeRun?.status}
          latestRunStatus={latestRunStatus}
          continuePending={continuePending}
          continueError={continueError}
          onContinue={onContinue}
        />
        {continuation && (
          <details className="workspace-handoff">
            <summary>
              Session 交接包
              <span>{continuation.strategy === 'MODEL' ? '模型摘要' : '确定性摘要'}</span>
            </summary>
            <p>{continuation.summaryText}</p>
            <small>
              {continuation.consumedAt
                ? '交接内容已在首次 Run 中注入。'
                : '首次成功发送 Run 时注入一次，失败重试不会丢失。'}
            </small>
          </details>
        )}
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
        {timeline.map((item) => {
          if (item.kind === 'tool') return <ToolEventRow key={item.id} event={item.event} />;
          if (item.kind === 'thought') {
            return (
              <ThoughtEventRow key={item.id} thought={item} running={item.id === activeThoughtId} />
            );
          }
          const { message } = item;
          const presentation = presentAgentMessage(message.text);
          return (
            <article className={`message ${message.role.toLowerCase()}`} key={message.id}>
              <div className="message-meta">
                <span className="message-author">
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
                <div className="message-body message-markdown">
                  <RichMessage text={presentation.text} />
                </div>
              )}
            </article>
          );
        })}
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

function ToolEventRow({ event }: { event: EventRecord }) {
  const status = event.type.endsWith('.failed')
    ? 'failed'
    : event.type.endsWith('.completed')
      ? 'completed'
      : 'running';
  const rawTool = event.payloadJson.tool ?? event.payloadJson.name;
  const title = String(
    event.payloadJson.title ??
      (rawTool === undefined
        ? event.type === 'agent.plan.updated'
          ? '更新执行计划'
          : '调用工具'
        : labelToolName(String(rawTool))),
  );
  const detailValue =
    event.payloadJson.command ??
    event.payloadJson.path ??
    event.payloadJson.query ??
    event.payloadJson.url ??
    readToolLocation(event.payloadJson.locations) ??
    event.payloadJson.kind;
  return (
    <details className={`tool-event-row tool-event-${status}`}>
      <summary aria-label={`${title}，${labelAgentEventType(event.type)}，展开详情`}>
        <span className="tool-event-icon" aria-hidden="true">
          {status === 'running' ? (
            <LoaderCircle className="spin" size={14} />
          ) : status === 'failed' ? (
            <AlertTriangle size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
        </span>
        <span className="tool-event-copy">
          <span>
            <strong>{title}</strong>
            <small>
              {status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '进行中'}
            </small>
          </span>
          {detailValue !== undefined && <code>{String(detailValue)}</code>}
        </span>
        <ChevronRight className="tool-event-action" size={13} aria-hidden="true" />
      </summary>
      <div className="tool-event-detail">
        <Link to="?view=activity">
          <Wrench size={12} aria-hidden="true" /> 在工具检查器中查看
        </Link>
      </div>
    </details>
  );
}

function ThoughtEventRow({
  thought,
  running,
}: {
  thought: ConversationTimelineItem & { kind: 'thought' };
  running: boolean;
}) {
  const duration = Math.max(0, Date.parse(thought.updatedAt) - Date.parse(thought.createdAt));
  return (
    <details className={`thought-event-row${running ? ' running' : ''}`}>
      <summary aria-label={running ? '正在思考，展开思考过程' : '展开思考过程'}>
        <span className="thought-event-pulse" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <strong>{running ? '正在思考' : `思考了 ${formatThoughtDuration(duration)}`}</strong>
        <ChevronRight className="thought-event-action" size={13} aria-hidden="true" />
      </summary>
      <div className="thought-event-content message-markdown">
        <RichMessage text={thought.text || 'Agent 未提供可展示的思考内容。'} />
      </div>
    </details>
  );
}

const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  apply_patch: '修改文件',
  exec_command: '运行命令',
  run_tests: '运行测试',
  search: '搜索代码',
  search_query: '搜索网页',
  open: '查看网页',
};

function labelToolName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return TOOL_LABELS[normalized] ?? value;
}

function readToolLocation(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  if (!first || typeof first !== 'object' || !('path' in first)) return undefined;
  return typeof first.path === 'string' ? first.path : undefined;
}

function formatThoughtDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

function RichMessage({ text }: { text: string }) {
  return (
    <Suspense fallback={<span className="message-markdown-loading">{text}</span>}>
      <MarkdownMessage text={text} />
    </Suspense>
  );
}
