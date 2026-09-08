import {
  AlertTriangle,
  AhButton,
  Brain,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Wrench,
} from '@agenthub/ui';
import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';

import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../../components/Feedback';
import type {
  ApprovalRecord,
  EventRecord,
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
import conversationStyles from '../conversation.module.css';
import {
  buildConversationTimeline,
  buildConversationTurns,
  CONVERSATION_WINDOW_SIZE,
  CONVERSATION_WINDOW_STEP,
  getConversationWindowStart,
  groupToolTimeline,
  summarizeToolExecution,
} from './conversationModel';
import type {
  ConversationApprovalItem,
  ConversationToolGroup,
  ConversationTimelineItem,
} from './conversationModel';

export {
  buildConversationTimeline,
  CONVERSATION_WINDOW_SIZE,
  CONVERSATION_WINDOW_STEP,
  getConversationWindowStart,
  groupToolTimeline,
  buildConversationTurns,
  mergeConversationText,
  summarizeToolExecution,
} from './conversationModel';

const MarkdownMessage = lazy(() => import('./MarkdownMessage'));

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
  const turns = buildConversationTurns(
    buildConversationTimeline(messages.data ?? [], events.data ?? [], approvals.data ?? []),
  );
  const timeline = turns.flatMap((turn) => turn.entries);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followTimelineRef = useRef(true);
  // Layout effects and the virtualizer can emit a synthetic scroll event while
  // the panel is still acquiring its real height. Keep the initial follow
  // intent authoritative until the first non-zero viewport has been aligned.
  const initialFollowPendingRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingPreviousRef = useRef(false);
  const [timelineWindowStart, setTimelineWindowStart] = useState(0);
  const [isFollowingTimeline, setIsFollowingTimeline] = useState(true);
  const [viewportMeasured, setViewportMeasured] = useState(false);
  const latestTimelineId = timeline.at(-1)?.id;
  const latestWindowStart = getConversationWindowStart(turns.length);
  const visibleTurns = turns.slice(
    timelineWindowStart,
    timelineWindowStart + CONVERSATION_WINDOW_SIZE,
  );
  const displayTurns = visibleTurns.map((turn) => ({
    ...turn,
    entries: groupToolTimeline(turn.entries),
  }));
  const timelineVirtualizer = useVirtualizer({
    count: displayTurns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 160,
    overscan: 5,
    getItemKey: (index) => displayTurns[index]?.id ?? index,
  });
  const virtualTimelineItems = timelineVirtualizer.getVirtualItems();
  // jsdom and an initially hidden drawer do not expose a scroll rect. Keep a
  // deterministic non-virtual fallback until the virtualizer receives a real
  // viewport measurement; this prevents a synthetic zero-height viewport from
  // rendering only the first turn and hiding the newest response.
  const shouldVirtualize = displayTurns.length > 15 && viewportMeasured;
  const activeThoughtId = activeRun
    ? [...timeline].reverse().find((item) => item.kind === 'thought' && item.runId === activeRun.id)
        ?.id
    : undefined;
  const clearUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = false;
    if (userScrollIntentTimerRef.current !== undefined) {
      clearTimeout(userScrollIntentTimerRef.current);
      userScrollIntentTimerRef.current = undefined;
    }
  }, []);
  const markUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = true;
    if (userScrollIntentTimerRef.current !== undefined) {
      clearTimeout(userScrollIntentTimerRef.current);
    }
    userScrollIntentTimerRef.current = setTimeout(() => {
      userScrollIntentRef.current = false;
      userScrollIntentTimerRef.current = undefined;
    }, 240);
  }, []);
  useEffect(() => {
    initialFollowPendingRef.current = true;
    followTimelineRef.current = true;
    clearUserScrollIntent();
    setIsFollowingTimeline(true);
    setTimelineWindowStart(0);
  }, [clearUserScrollIntent, session.id]);
  useEffect(() => clearUserScrollIntent, [clearUserScrollIntent]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateViewport = () => setViewportMeasured(element.clientHeight > 0);
    updateViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewport);
      return () => window.removeEventListener('resize', updateViewport);
    }
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [session.id]);
  useEffect(() => {
    setTimelineWindowStart((current) =>
      followTimelineRef.current ? latestWindowStart : Math.min(current, latestWindowStart),
    );
  }, [latestWindowStart]);
  useEffect(() => {
    if (!followTimelineRef.current) return;
    let trailingFrame: number | undefined;
    const scrollToLatest = () => {
      const element = scrollRef.current;
      if (!element || element.clientHeight <= 0 || userScrollIntentRef.current) return;
      initialFollowPendingRef.current = false;
      element.scrollTop = element.scrollHeight;
    };
    const scheduleScroll = () => {
      if (!followTimelineRef.current || userScrollIntentRef.current) return;
      requestAnimationFrame(() => {
        if (!followTimelineRef.current || userScrollIntentRef.current) return;
        trailingFrame = requestAnimationFrame(scrollToLatest);
      });
    };
    scheduleScroll();
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return () => {
        if (trailingFrame !== undefined) cancelAnimationFrame(trailingFrame);
      };
    }
    const observer = new ResizeObserver(scheduleScroll);
    observer.observe(element);
    const content = element.querySelector<HTMLElement>(
      '.conversation-timeline, .conversation-virtual-list',
    );
    if (content) observer.observe(content);
    return () => {
      observer.disconnect();
      if (trailingFrame !== undefined) cancelAnimationFrame(trailingFrame);
    };
  }, [displayTurns.length, latestTimelineId, viewportMeasured]);
  const scheduleLatestScroll = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (
          element &&
          followTimelineRef.current &&
          !userScrollIntentRef.current &&
          element.clientHeight > 0
        ) {
          initialFollowPendingRef.current = false;
          element.scrollTop = element.scrollHeight;
        }
      });
    });
  };
  const preserveScrollAnchor = (previousHeight: number, previousTop: number) => {
    requestAnimationFrame(() => {
      const current = scrollRef.current;
      if (current) current.scrollTop = current.scrollHeight - previousHeight + previousTop;
    });
  };
  const loadPreviousMessages = async () => {
    const canFetchPrevious = Boolean(
      hasPreviousMessages && onLoadPreviousMessages && !isLoadingPreviousMessages,
    );
    const canRevealOlderWindow = timelineWindowStart > 0;
    if ((!canFetchPrevious && !canRevealOlderWindow) || loadingPreviousRef.current) return;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    loadingPreviousRef.current = true;
    try {
      if (canRevealOlderWindow)
        setTimelineWindowStart((current) => Math.max(0, current - CONVERSATION_WINDOW_STEP));
      if (canFetchPrevious) await onLoadPreviousMessages?.();
    } finally {
      preserveScrollAnchor(previousHeight, previousTop);
      loadingPreviousRef.current = false;
    }
  };
  const jumpToLatest = () => {
    initialFollowPendingRef.current = false;
    clearUserScrollIntent();
    followTimelineRef.current = true;
    setIsFollowingTimeline(true);
    setTimelineWindowStart(latestWindowStart);
    scheduleLatestScroll();
  };
  const showEmpty =
    !messages.isLoading &&
    !events.isLoading &&
    !approvals.isLoading &&
    !messages.error &&
    !events.error &&
    !approvals.error &&
    timeline.length === 0;
  const renderItemProps = {
    resolving,
    resolveError,
    resolveVariables,
    activeThoughtId,
    onResolve: resolveApproval,
  };
  return (
    <section
      className={`${conversationStyles.owner} conversation flex min-h-0 h-full flex-col overflow-hidden bg-[hsl(var(--background))]`}
    >
      <div className="panel-title conversation-title hidden">
        <div>
          <span>对话</span>
          <small>{activeRun ? 'Agent 正在处理当前指令' : '消息与执行记录'}</small>
        </div>
        {activeRun && <StatusBadge status={activeRun.status} />}
      </div>
      <div
        ref={scrollRef}
        className="group/chatscroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[hsl(var(--background))] px-0.5 py-2 sm:px-1 sm:py-3"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onWheel={markUserScrollIntent}
        onPointerDown={(event) => {
          // Content clicks (for example expanding thought/tool details) must
          // not be mistaken for a scrollbar drag and break follow mode.
          if (event.target === event.currentTarget) markUserScrollIntent();
        }}
        onTouchMove={markUserScrollIntent}
        onKeyDown={(event) => {
          if (
            ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)
          ) {
            markUserScrollIntent();
          }
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nextFollowing =
            element.scrollHeight - element.scrollTop - element.clientHeight < 120;
          const userInitiated = userScrollIntentRef.current;
          if (userInitiated) clearUserScrollIntent();
          if (!userInitiated && followTimelineRef.current) {
            if (!nextFollowing) scheduleLatestScroll();
            return;
          }
          if (!userInitiated && initialFollowPendingRef.current && !nextFollowing) return;
          if (initialFollowPendingRef.current) initialFollowPendingRef.current = false;
          followTimelineRef.current = nextFollowing;
          setIsFollowingTimeline((current) =>
            current === nextFollowing ? current : nextFollowing,
          );
          if (element.scrollTop < 80) void loadPreviousMessages();
        }}
      >
        {(hasPreviousMessages || isLoadingPreviousMessages || timelineWindowStart > 0) && (
          <div className="conversation-history-control">
            <button
              type="button"
              onClick={() => void loadPreviousMessages()}
              disabled={Boolean(isLoadingPreviousMessages)}
              aria-label="加载更早消息"
            >
              {isLoadingPreviousMessages
                ? '正在加载更早消息…'
                : timelineWindowStart > 0
                  ? '查看更早消息'
                  : '加载更早消息'}
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
        {shouldVirtualize ? (
          <div
            className="conversation-virtual-list relative min-h-px w-full"
            style={{ height: timelineVirtualizer.getTotalSize() }}
          >
            {virtualTimelineItems.map((virtualItem) => {
              const turn = displayTurns[virtualItem.index];
              if (!turn) return null;
              return (
                <div
                  key={virtualItem.key}
                  ref={timelineVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="conversation-virtual-item absolute left-0 top-0 w-full will-change-transform"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {virtualItem.index > 0 && <ConversationTurnDivider />}
                  <ConversationTurnView turn={turn} {...renderItemProps} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="conversation-timeline grid gap-1.5 px-0.5 py-2 sm:gap-3 sm:px-1 sm:py-3">
            {displayTurns.map((turn, index) => (
              <Fragment key={turn.id}>
                {index > 0 && <ConversationTurnDivider />}
                <ConversationTurnView turn={turn} {...renderItemProps} />
              </Fragment>
            ))}
          </div>
        )}
      </div>
      {!isFollowingTimeline && (
        <button
          type="button"
          className="conversation-jump-latest"
          aria-label="回到最新"
          onClick={jumpToLatest}
        >
          <ChevronDown size={14} aria-hidden="true" />
          回到最新
        </button>
      )}
    </section>
  );
}

function ConversationTurnDivider() {
  return (
    <div className="mx-auto my-2 flex w-[85%] items-center gap-3 sm:my-3" aria-hidden="true">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[hsl(var(--border))]/50 to-transparent" />
    </div>
  );
}

type ConversationTurnViewModel = {
  id: string;
  entries: Array<ConversationTimelineItem | ConversationToolGroup>;
};

type ConversationTurnViewProps = {
  turn: ConversationTurnViewModel;
} & Omit<ConversationTimelineItemViewProps, 'item'>;

function ConversationTurnView({ turn, ...itemProps }: ConversationTurnViewProps) {
  const userEntries = turn.entries.filter(
    (item) => item.kind === 'message' && item.message.role === 'USER',
  );
  const assistantEntries = turn.entries.filter(
    (item) => !(item.kind === 'message' && item.message.role === 'USER'),
  );
  return (
    <article
      className="conversation-turn min-w-0 px-0.5 py-1 animate-[hci-entry_var(--anim-entry-fast)_var(--ease-out-expo)_both]"
      data-turn-id={turn.id}
    >
      {userEntries.map((item) => (
        <ConversationTimelineItemView key={item.id} item={item} {...itemProps} />
      ))}
      {assistantEntries.length > 0 && (
        <section className="mx-4 mb-1 min-w-0 py-2 sm:mx-5">
          <header className="mb-2 flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[hsl(var(--primary))]/[0.08]">
              <Bot className="h-3 w-3 text-[hsl(var(--primary))]/80" />
            </span>
            <span className="text-[12px] font-medium text-[hsl(var(--foreground-muted))]">
              Agent
            </span>
          </header>
          <div className="min-w-0 space-y-1">
            {assistantEntries.map((item) => (
              <ConversationTimelineItemView key={item.id} item={item} {...itemProps} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

type ConversationTimelineItemViewProps = {
  item: ConversationTimelineItem | ConversationToolGroup;
  resolving: string | undefined;
  resolveError: Error | undefined;
  resolveVariables: { id: string; optionId: string } | undefined;
  activeThoughtId: string | undefined;
  onResolve: (variables: { id: string; optionId: string }) => void;
};

function ConversationTimelineItemView({
  item,
  resolving,
  resolveError,
  resolveVariables,
  activeThoughtId,
  onResolve,
}: ConversationTimelineItemViewProps) {
  if (item.kind === 'tool-group') {
    return <ToolExecutionGroupRow events={item.events} />;
  }
  if (item.kind === 'tool') return <ToolEventRow event={item.event} />;
  if (item.kind === 'approval') {
    return (
      <ApprovalEventRow
        approvalItem={item}
        resolving={resolving}
        resolveError={resolveError}
        resolveVariables={resolveVariables}
        onResolve={onResolve}
      />
    );
  }
  if (item.kind === 'thought') {
    return <ThoughtEventRow thought={item} running={item.id === activeThoughtId} />;
  }

  const { message } = item;
  const presentation = presentAgentMessage(message.text);
  const isUser = message.role === 'USER';
  const author =
    message.role === 'USER'
      ? '你'
      : message.role === 'ASSISTANT'
        ? 'Agent'
        : message.role === 'SYSTEM'
          ? '系统'
          : '工具';
  const timestamp = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  return (
    <div
      className={
        isUser
          ? 'group/msg flex justify-end px-3 py-1.5 animate-[hci-entry_var(--anim-entry-fast)_var(--ease-out-expo)_both] sm:px-4'
          : 'min-w-0 px-0.5 py-1'
      }
      data-chat-entry
    >
      {isUser && timestamp ? (
        <span className="mr-2 self-center text-[10px] text-[hsl(var(--foreground-faint))] opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100">
          {timestamp}
        </span>
      ) : null}
      <article
        className={
          isUser
            ? 'message user message-user min-w-0 max-w-[88%] sm:max-w-[78%]'
            : `message ${message.role.toLowerCase()} message-assistant min-w-0 text-[15px] leading-[1.72] tracking-[-0.008em] text-[hsl(var(--foreground))]`
        }
        data-streaming={item.streaming ? 'true' : undefined}
      >
        {!isUser && message.role !== 'ASSISTANT' ? (
          <span className="mb-1 block text-[11px] font-medium text-[hsl(var(--foreground-faint))]">
            {author}
          </span>
        ) : null}
        {presentation.kind === 'TRANSPORT_ERROR' ? (
          <div className="message-body message-body-error rounded-lg border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))] px-3 py-2.5 text-[hsl(var(--destructive))]">
            <strong>{presentation.title}</strong>
            <p className="mt-1.5 text-[hsl(var(--foreground-muted))]">{presentation.text}</p>
            <details className="message-debug mt-2.5 text-[12px] text-[hsl(var(--foreground-muted))]">
              <summary>显示脱敏诊断</summary>
              <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-[hsl(var(--destructive-soft))]/60 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {presentation.debug}
              </pre>
            </details>
          </div>
        ) : (
          <div
            className={`message-body message-markdown min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${isUser ? 'rounded-2xl rounded-tr-md border border-[hsl(var(--primary))]/18 bg-gradient-to-br from-[hsl(var(--primary))]/[0.09] to-[hsl(var(--primary))]/[0.05] px-3.5 py-2.5 shadow-[0_1px_4px_hsl(var(--foreground)/0.06)] transition-[border-color,box-shadow] duration-150 hover:border-[hsl(var(--primary))]/28 hover:shadow-[0_2px_8px_hsl(var(--primary)/0.1)]' : ''}`}
          >
            <RichMessage text={presentation.text} />
            {item.streaming && (
              <span
                className="ml-1 inline-block w-0.5 text-[hsl(var(--primary))] animate-[streaming-type-caret-blink_820ms_steps(1,end)_infinite]"
                aria-label="正在接收 Agent 回复"
                role="status"
              >
                ▍
              </span>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

function formatToolExecutionSummary(summary: ReturnType<typeof summarizeToolExecution>): string {
  return [
    `执行了 ${summary.operations} 个操作`,
    summary.files ? `${summary.files} 文件` : undefined,
    summary.commands ? `${summary.commands} 命令` : undefined,
    summary.searches ? `${summary.searches} 搜索` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function ApprovalEventRow({
  approvalItem,
  resolving,
  resolveError,
  resolveVariables,
  onResolve,
}: {
  approvalItem: ConversationApprovalItem;
  resolving: string | undefined;
  resolveError: Error | undefined;
  resolveVariables: { id: string; optionId: string } | undefined;
  onResolve: (variables: { id: string; optionId: string }) => void;
}) {
  const { approval } = approvalItem;
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
      className={`approval-card tool-entry-motion tool-entry-card mx-auto w-full max-w-3xl rounded-lg border px-3.5 py-3 ${deliveryUnconfirmed || deliveryAborted ? 'approval-card-attention border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive-soft))]/45' : 'border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning-soft))]/45'}`}
      data-sequence={approvalItem.firstSeq}
    >
      <div className="approval-heading flex items-start gap-2.5">
        <span>
          {deliveryInProgress ? (
            <LoaderCircle className="spin" size={17} />
          ) : deliveryUnconfirmed || deliveryAborted ? (
            <AlertTriangle size={17} />
          ) : (
            <ShieldCheck size={17} />
          )}
        </span>
        <div className="approval-heading-copy grid min-w-0 gap-0.5">
          <small className="approval-kicker text-[11px] text-[hsl(var(--foreground-muted))]">
            {awaitingDecision ? 'Agent 请求' : deliveryInProgress ? '正在处理' : '投递结果'}
          </small>
          <strong className="text-[13px] text-[hsl(var(--foreground))]">{approval.title}</strong>
        </div>
      </div>
      {approval.description && (
        <div className="approval-impact mt-3 grid gap-1 border-t border-[hsl(var(--border))]/45 pt-2 text-[12px]">
          <span>影响</span>
          <p>{approval.description}</p>
        </div>
      )}
      {awaitingDecision && (
        <>
          <span className="approval-options-label mt-3 block text-[11px] font-medium text-[hsl(var(--foreground-muted))]">
            可选操作
          </span>
          {approval.optionsJson.some((option) => option.id) ? (
            <div
              className="approval-actions mt-2 flex flex-wrap gap-2"
              aria-label="合法操作选项"
              aria-busy={resolving === approval.id}
            >
              {approval.optionsJson.map(
                (option) =>
                  option.id && (
                    <AhButton
                      key={option.id}
                      color={
                        /reject|deny|refuse/i.test(
                          `${option.kind ?? ''} ${option.id} ${option.label ?? ''}`,
                        )
                          ? 'gray'
                          : 'orange'
                      }
                      size="xs"
                      variant={
                        /reject|deny|refuse/i.test(
                          `${option.kind ?? ''} ${option.id} ${option.label ?? ''}`,
                        )
                          ? 'light'
                          : 'filled'
                      }
                      onClick={() => onResolve({ id: approval.id, optionId: option.id! })}
                      disabled={Boolean(resolving)}
                    >
                      {option.label ?? option.id}
                    </AhButton>
                  ),
              )}
            </div>
          ) : (
            <div
              className="approval-no-options mt-2 rounded-md border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))] px-2.5 py-2 text-[12px]"
              role="alert"
            >
              Agent 没有提供可执行选项，请返回 Session 列表重新开始。
            </div>
          )}
        </>
      )}
      {deliveryInProgress && (
        <div
          className="approval-delivery-status mt-3 grid gap-1 rounded-md border border-[hsl(var(--border))]/45 bg-[hsl(var(--surface))]/65 px-2.5 py-2 text-[12px]"
          role="status"
          aria-live="polite"
        >
          <strong>决定已保存</strong>
          <span>
            已选择“{selectedOption?.label ?? '已记录选项'}”，正在等待 Agent 确认接收，请勿重复操作。
          </span>
        </div>
      )}
      {deliveryUnconfirmed && (
        <div
          className="approval-delivery-status approval-delivery-status-danger mt-3 grid gap-1 rounded-md border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))]/70 px-2.5 py-2 text-[12px]"
          role="alert"
        >
          <strong>无法确认 Agent 是否收到</strong>
          <span>{deliveryFailureCopy}</span>
          <Link to="/sessions">前往 Session 列表恢复或重新开始</Link>
        </div>
      )}
      {deliveryAborted && (
        <div
          className="approval-delivery-status approval-delivery-status-danger mt-3 grid gap-1 rounded-md border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))]/70 px-2.5 py-2 text-[12px]"
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
            <AhButton
              color="red"
              size="xs"
              variant="light"
              disabled={Boolean(resolving)}
              onClick={() => onResolve(resolveVariables)}
            >
              重试此选项
            </AhButton>
          )}
        </div>
      )}
      <details className="approval-debug mt-3 border-t border-[hsl(var(--border))]/40 pt-2 text-[11px] text-[hsl(var(--foreground-muted))]">
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
}

function ToolExecutionGroupRow({ events }: { events: EventRecord[] }) {
  const summary = summarizeToolExecution(events);
  const title = formatToolExecutionSummary(summary);
  const status = events.some((event) => event.type.endsWith('.failed'))
    ? 'failed'
    : events.some((event) => !event.type.endsWith('.completed'))
      ? 'running'
      : 'completed';
  const labels = [...new Set(events.map((event) => toolEventTitle(event)))];
  const details = labels.slice(0, 3).join('、');
  return (
    <details
      className={`tool-event-row tool-entry-motion tool-entry-card tool-execution-group tool-event-${status}`}
    >
      <summary
        className="tool-entry-trigger tool-entry-trigger--interactive"
        aria-label={`${title}，展开执行详情`}
      >
        <span className="tool-event-icon tool-entry-icon" aria-hidden="true">
          {status === 'running' ? (
            <LoaderCircle className="spin" size={14} />
          ) : status === 'failed' ? (
            <AlertTriangle size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
        </span>
        <span className="tool-event-copy min-w-0 flex-1">
          <span>
            <strong>{title}</strong>
            <small className="tool-entry-badge">
              {status === 'completed' ? '已完成' : status === 'failed' ? '部分失败' : '进行中'}
            </small>
          </span>
          {details && <code>{details}</code>}
        </span>
        <ChevronRight
          className="tool-event-action tool-entry-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="tool-event-detail tool-entry-detail">
        <ul className="tool-event-group-list tool-entry-detail-body space-y-1 border-t border-[hsl(var(--border))]/35 px-3 py-2">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{toolEventTitle(event)}</strong>
              <span>{toolEventStatus(event)}</span>
              {toolEventDetail(event) && <code>{toolEventDetail(event)}</code>}
            </li>
          ))}
        </ul>
        <Link to="?view=activity">
          <Wrench size={12} aria-hidden="true" /> 在工具检查器中查看完整记录
        </Link>
      </div>
    </details>
  );
}

function ToolEventRow({ event }: { event: EventRecord }) {
  const status = toolEventStatusValue(event);
  const title = toolEventTitle(event);
  const detailValue = toolEventDetail(event);
  return (
    <details className={`tool-event-row tool-entry-motion tool-entry-card tool-event-${status}`}>
      <summary
        className="tool-entry-trigger tool-entry-trigger--interactive"
        aria-label={`${title}，${labelAgentEventType(event.type)}，展开详情`}
      >
        <span className="tool-event-icon tool-entry-icon" aria-hidden="true">
          {status === 'running' ? (
            <LoaderCircle className="spin" size={14} />
          ) : status === 'failed' ? (
            <AlertTriangle size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
        </span>
        <span className="tool-event-copy min-w-0 flex-1">
          <span>
            <strong>{title}</strong>
            <small className="tool-entry-badge">
              {status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '进行中'}
            </small>
          </span>
          {detailValue !== undefined && <code>{String(detailValue)}</code>}
        </span>
        <ChevronRight
          className="tool-event-action tool-entry-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="tool-event-detail tool-entry-detail border-t border-[hsl(var(--border))]/35 px-3 py-2">
        <Link to="?view=activity">
          <Wrench size={12} aria-hidden="true" /> 在工具检查器中查看
        </Link>
      </div>
    </details>
  );
}

function toolEventStatusValue(event: EventRecord): 'failed' | 'completed' | 'running' {
  return event.type.endsWith('.failed')
    ? 'failed'
    : event.type.endsWith('.completed')
      ? 'completed'
      : 'running';
}

function toolEventStatus(event: EventRecord): string {
  const status = toolEventStatusValue(event);
  return status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '进行中';
}

function toolEventTitle(event: EventRecord): string {
  const rawTool = event.payloadJson.tool ?? event.payloadJson.name;
  return String(
    event.payloadJson.title ??
      (rawTool === undefined
        ? event.type === 'agent.plan.updated'
          ? '更新执行计划'
          : '调用工具'
        : labelToolName(String(rawTool))),
  );
}

function toolEventDetail(event: EventRecord): string | undefined {
  const value =
    event.payloadJson.command ??
    event.payloadJson.path ??
    event.payloadJson.query ??
    event.payloadJson.url ??
    readToolLocation(event.payloadJson.locations) ??
    event.payloadJson.kind;
  return value === undefined ? undefined : String(value);
}

function ThoughtEventRow({
  thought,
  running,
}: {
  thought: ConversationTimelineItem & { kind: 'thought' };
  running: boolean;
}) {
  const duration = Math.max(0, Date.parse(thought.updatedAt) - Date.parse(thought.createdAt));
  const label = running ? '正在思考' : `思考了 ${formatThoughtDuration(duration)}`;
  return (
    <details
      className={`thought-event-row tool-entry-motion my-1 overflow-hidden rounded-lg border border-violet-200/60 bg-gradient-to-r from-violet-500/[0.04] to-indigo-500/[0.02] dark:border-violet-500/20 dark:from-violet-500/[0.08] dark:to-indigo-500/[0.04]${running ? ' running tool-entry-card--active' : ''}`}
    >
      <summary
        className="tool-entry-trigger tool-entry-trigger--interactive rounded-lg px-2.5 py-1.5"
        aria-label={running ? '正在思考，展开思考过程' : '展开思考过程'}
      >
        <span
          className="thought-event-pulse tool-entry-icon flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-800/50 dark:to-indigo-800/40"
          aria-hidden="true"
        >
          {running ? (
            <>
              <i />
              <i />
              <i />
            </>
          ) : (
            <Brain className="h-3 w-3 text-violet-500 dark:text-violet-400" />
          )}
        </span>
        <strong className="tool-entry-badge text-violet-600/90 dark:text-violet-300/90">
          {label}
        </strong>
        <ChevronRight
          className="thought-event-action tool-entry-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="thought-event-content tool-entry-detail message-markdown border-t border-violet-200/50 bg-[hsl(var(--surface))]/60 px-3 py-2 dark:border-violet-500/15">
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
