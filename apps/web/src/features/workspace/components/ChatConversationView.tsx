/**
 * ChatConversationView — direct AgentHub port of
 * /volume2/Project/PinHarness/web/src/components/run/chat/ChatConversationView.tsx.
 *
 * The source turn shell, history affordance, jump-to-latest control and
 * round-level renderer are retained. AgentHub owns only its API record adapter
 * and approval delivery semantics.
 */

import { Bot, ChevronDown } from '@agenthub/ui';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { EmptyState, ErrorState, LoadingState } from '../../../components/Feedback';
import type {
  ApprovalRecord,
  EventRecord,
  RunRecord,
  SessionContinuationRecord,
  SessionRecord,
} from '../../../lib/api';
import type { MessageQueryState, QueryState } from '../workspace-types';
import { RunStateBanner } from './RunStateBanner';
import {
  buildConversationTimeline,
  buildConversationTurns,
  CONVERSATION_WINDOW_SIZE,
  CONVERSATION_WINDOW_STEP,
  getConversationWindowStart,
  groupToolTimeline,
} from './conversationModel';
import type { ConversationToolGroup, ConversationTimelineItem } from './conversationModel';
import { ChatEntryRenderer, type ChatEntryRendererProps } from './ChatEntryRenderer';

// Before a real viewport height is available (for example while a drawer is
// opening), keep the source's progressive rendering intent instead of mounting
// the entire 500-turn window. Once measured, the normal 500-turn window is
// handed to @tanstack/react-virtual below.
// This bootstrap window is only used while a drawer/hidden panel has no
// measurable viewport. Keep it intentionally small so the newest response is
// available immediately; a measured viewport switches to the normal virtual
// window below without changing the visible conversation order.
const UNMEASURED_WINDOW_SIZE = 8;

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

/** PinHarness source component: ChatConversationView owns scroll, rounds and composer adjacency. */
export function ChatConversationView({
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
  composer,
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
  /** PinHarness keeps the CommandBar adjacent to the conversation in this source shell. */
  composer?: ReactNode;
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
  // Record an actual wheel/touch/key navigation separately from the transient
  // debounce guard so synthetic layout scroll events cannot hide the newest
  // window during the first data render.
  const userNavigatedTimelineRef = useRef(false);
  const userScrollIntentTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingPreviousRef = useRef(false);
  const [timelineWindowStart, setTimelineWindowStart] = useState(0);
  const [isFollowingTimeline, setIsFollowingTimeline] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousTimelineLengthRef = useRef(timeline.length);
  const [viewportMeasured, setViewportMeasured] = useState(false);
  const latestTimelineId = timeline.at(-1)?.id;
  const latestWindowStart = getConversationWindowStart(turns.length);
  // The first data render must already show the newest window. Waiting for the
  // effect below would mount up to 500 historical turns first, which is both
  // visually wrong and slow enough to starve the state update under load. The
  // A user navigation clears this derived shortcut, so an intentional move to
  // history still starts at index 0 without fighting the latest-window default.
  const effectiveTimelineWindowStart =
    followTimelineRef.current && !userNavigatedTimelineRef.current && timelineWindowStart === 0
      ? latestWindowStart
      : timelineWindowStart;
  const unmeasuredTimeline = !viewportMeasured && turns.length > CONVERSATION_WINDOW_SIZE;
  const renderWindowSize = unmeasuredTimeline ? UNMEASURED_WINDOW_SIZE : CONVERSATION_WINDOW_SIZE;
  const renderWindowStart =
    unmeasuredTimeline &&
    followTimelineRef.current &&
    effectiveTimelineWindowStart >= latestWindowStart
      ? Math.max(latestWindowStart, turns.length - renderWindowSize)
      : effectiveTimelineWindowStart;
  const visibleTurns = turns.slice(renderWindowStart, renderWindowStart + renderWindowSize);
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
    userNavigatedTimelineRef.current = true;
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
    userNavigatedTimelineRef.current = false;
    clearUserScrollIntent();
    setIsFollowingTimeline(true);
    setUnreadCount(0);
    setTimelineWindowStart(0);
  }, [clearUserScrollIntent, session.id]);
  useEffect(() => clearUserScrollIntent, [clearUserScrollIntent]);
  useEffect(() => {
    const previousLength = previousTimelineLengthRef.current;
    if (!isFollowingTimeline && timeline.length > previousLength) {
      setUnreadCount((count) => count + timeline.length - previousLength);
    }
    if (isFollowingTimeline) setUnreadCount(0);
    previousTimelineLengthRef.current = timeline.length;
  }, [isFollowingTimeline, timeline.length]);
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
    const canRevealOlderWindow =
      effectiveTimelineWindowStart > 0 ||
      (userNavigatedTimelineRef.current && latestWindowStart > 0);
    if ((!canFetchPrevious && !canRevealOlderWindow) || loadingPreviousRef.current) return;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    loadingPreviousRef.current = true;
    try {
      if (canRevealOlderWindow)
        setTimelineWindowStart((current) =>
          Math.max(
            0,
            (current === 0 ? effectiveTimelineWindowStart : current) - CONVERSATION_WINDOW_STEP,
          ),
        );
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
    setUnreadCount(0);
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
      className="conversation flex h-full min-h-0 flex-col overflow-hidden bg-[hsl(var(--background))]"
      aria-label="Agent 对话"
    >
      <span className="sr-only">消息与执行记录</span>
      <div className="group/chatscroll relative min-h-0 flex-1">
        <div className="conversation-top-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-[hsl(var(--background))] to-transparent" />
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto overscroll-contain px-0.5 py-2 sm:px-1 sm:py-3"
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
                    {virtualItem.index > 0 && <RoundDivider />}
                    <RoundBlock turn={turn} {...renderItemProps} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="conversation-timeline grid gap-1.5 px-0.5 py-2 sm:gap-3 sm:px-1 sm:py-3">
              {displayTurns.map((turn, index) => (
                <Fragment key={turn.id}>
                  {index > 0 && <RoundDivider />}
                  <RoundBlock turn={turn} {...renderItemProps} />
                </Fragment>
              ))}
            </div>
          )}
        </div>
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
          {unreadCount > 0 && (
            <span className="rounded-full bg-[hsl(var(--primary))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--primary-foreground))]">
              {unreadCount}
            </span>
          )}
        </button>
      )}
      {composer ? (
        <div className="chat-composer-dock relative shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom),var(--mobile-keyboard-inset,0px))] pt-1 before:pointer-events-none before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-gradient-to-t before:from-[hsl(var(--background))]/85 before:to-transparent sm:px-4 sm:pb-3 sm:pt-2 sm:before:-top-5 sm:before:h-5">
          {composer}
        </div>
      ) : null}
    </section>
  );
}

/** Compatibility export for existing AgentHub route/tests while callers migrate to source name. */
export const Conversation = ChatConversationView;

/** PinHarness source divider: a quiet gradient line between completed rounds. */
function RoundDivider() {
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
} & Omit<ChatEntryRendererProps, 'item'>;

/** PinHarness source name: RoundBlock groups one user turn and its ordered Agent entries. */
function RoundBlock({ turn, ...itemProps }: ConversationTurnViewProps) {
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
        <ChatEntryRenderer key={item.id} item={item} {...itemProps} />
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
              <ChatEntryRenderer key={item.id} item={item} {...itemProps} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
