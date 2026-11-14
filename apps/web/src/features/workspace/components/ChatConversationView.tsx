import type { MessageLocationRequest } from '../messageLocation';
import { useApprovalResolution } from './useApprovalResolution';
/**
 * ChatConversationView — direct AgentHub port of
 * /volume2/Project/PinHarness/web/src/components/run/chat/ChatConversationView.tsx.
 *
 * The source turn shell, history affordance, jump-to-latest control and
 * round-level renderer are retained. AgentHub owns only its API record adapter
 * and approval delivery semantics.
 */

import { Bot, ChevronDown } from '@agenthub/ui';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { observeTimelineOffset } from '../lib/observe-timeline-offset';

import { EmptyState, ErrorState, LoadingState } from '../../../components/Feedback';
import { useAuthorizationRevocation } from '../useAuthorizationRevocation';
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
} from './conversationModel';
import type { ConversationToolGroup, ConversationTimelineItem } from './conversationModel';
import {
  ChatEntryActions,
  ChatEntryRenderer,
  type ChatEntryRendererProps,
} from './ChatEntryRenderer';

// Before a real viewport height is available (for example while a drawer is
// opening), keep the source's progressive rendering intent instead of mounting
// the entire 500-turn window. Once measured, the normal 500-turn window is
// handed to @tanstack/react-virtual below.
// This bootstrap window is only used while a drawer/hidden panel has no
// measurable viewport. Keep it intentionally small so the newest response is
// available immediately; a measured viewport switches to the normal virtual
// window below without changing the visible conversation order.
const UNMEASURED_WINDOW_SIZE = 4;
const STREAMING_LINE_HEIGHT_PX = 18;
const STREAMING_SMOOTH_DISTANCE_PX = 600;

function followStreamingBottom(
  element: HTMLDivElement,
  lastScrollHeightRef: { current: number },
  followingRef: { current: boolean },
  markProgrammaticScroll: () => void,
): number | undefined {
  const currentScrollHeight = element.scrollHeight;
  if (currentScrollHeight - lastScrollHeightRef.current < STREAMING_LINE_HEIGHT_PX) return;

  const distance = currentScrollHeight - element.scrollTop - element.clientHeight;
  if (distance <= 0) {
    lastScrollHeightRef.current = currentScrollHeight;
    return;
  }

  lastScrollHeightRef.current = currentScrollHeight;
  markProgrammaticScroll();
  if (distance < STREAMING_SMOOTH_DISTANCE_PX) {
    element.scrollTo({ top: currentScrollHeight, behavior: 'smooth' });
    return;
  }

  // Avoid animating a long stream over hundreds of pixels. Land close to the
  // tail first, then let one short smooth segment settle; if the user takes
  // over during the gap, the queued frame is discarded.
  element.scrollTop = Math.max(0, currentScrollHeight - 200);
  return requestAnimationFrame(() => {
    if (!followingRef.current) return;
    element.scrollTo({ top: currentScrollHeight, behavior: 'smooth' });
  });
}

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
export const ChatConversationView = memo(function ChatConversationView({
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
  onOpenFile,
  onOpenDiff,
  hasPreviousMessages,
  isLoadingPreviousMessages,
  onLoadPreviousMessages,
  composer,
  locationRequest,
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
  onOpenFile?: ((path: string) => void) | undefined;
  onOpenDiff?: ((path: string) => void) | undefined;
  hasPreviousMessages?: boolean;
  isLoadingPreviousMessages?: boolean;
  onLoadPreviousMessages?: () => Promise<unknown>;
  /** PinHarness keeps the CommandBar adjacent to the conversation in this source shell. */
  composer?: ReactNode;
  locationRequest?: MessageLocationRequest | null;
}) {
  const {
    approvalFeedback,
    resolving,
    resolveError,
    resolveVariables,
    resolveApproval,
    retryDeliveryRead,
    deliveryReadError,
    deliveryChecking,
  } = useApprovalResolution(session.id, approvals.data, onResolveApproval);
  const turns = buildConversationTurns(
    buildConversationTimeline(messages.data ?? [], events.data ?? [], approvals.data ?? []),
  );
  const timeline = turns.flatMap((turn) => turn.entries);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followTimelineRef = useRef(true);
  // PinHarness 的滚动控制将“用户接管”和“程序滚动”分成两个同步 ref。
  // 仅依赖 React state 会在 streaming/rAF 密集更新时读到旧闭包，导致上滑
  // 后又被下一帧拉回底部，表现为滚动鬼畜或卡死。
  const followingRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const programmaticCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineScrollRafRef = useRef<number | null>(null);
  const lastStreamingScrollHeightRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
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
  const cancelLocationRef = useRef(messages.cancelHistoryNavigation);
  cancelLocationRef.current = messages.cancelHistoryNavigation;
  const historyIdentityRef = useRef(session.id);
  const historyAuthorizedRef = useRef(true);
  const historyGenerationRef = useRef(0);
  const historyIntentRef = useRef(0);
  const historyFrameRef = useRef<number | null>(null);
  const loadingPreviousRef = useRef<symbol | null>(null);
  const committedAnchorRef = useRef<{
    oldest: number;
    windowStart: number;
    remote: boolean;
    newest: number;
    height: number;
    top: number;
    valid: () => boolean;
    data?: MessageQueryState['data'];
    events: typeof events.data;
    stable: number;
    samples: number;
    measuredHeight: number;
    expiry?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const clearCommittedAnchor = useCallback(() => {
    const anchor = committedAnchorRef.current;
    if (anchor) clearTimeout(anchor.expiry);
    committedAnchorRef.current = null;
  }, []);
  if (historyIdentityRef.current !== session.id) {
    historyIdentityRef.current = session.id;
    historyGenerationRef.current += 1;
    loadingPreviousRef.current = null;
  }
  const invalidateHistoryAnchor = useCallback(() => {
    clearCommittedAnchor();
    historyIntentRef.current += 1;
    if (historyFrameRef.current !== null) cancelAnimationFrame(historyFrameRef.current);
    historyFrameRef.current = null;
  }, [clearCommittedAnchor]);
  useAuthorizationRevocation(() => {
    historyAuthorizedRef.current = false;
    historyGenerationRef.current += 1;
    loadingPreviousRef.current = null;
    invalidateHistoryAnchor();
  });
  useEffect(() => {
    return () => {
      historyGenerationRef.current += 1;
      loadingPreviousRef.current = null;
      invalidateHistoryAnchor();
    };
  }, [invalidateHistoryAnchor, session.id]);
  const [timelineWindowStart, setTimelineWindowStart] = useState(0);
  const [isFollowingTimeline, setIsFollowingTimeline] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const latestSavedSequence = (messages.data ?? []).reduce(
    (max, message) => Math.max(max, message.sequence ?? 0),
    0,
  );
  const savedWatermark = useRef({ sessionId: session.id, sequence: latestSavedSequence });
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
  // PinHarness renders each ordered tool entry independently so the source
  // card header, status and expandable detail remain visible in the causal
  // stream. Keep groupToolTimeline exported for older consumers/tests, but do
  // not collapse the live Session view into a generic summary row.
  const displayTurns = visibleTurns.map((turn) => ({ ...turn }));
  const timelineVirtualizer = useVirtualizer({
    observeElementOffset: observeTimelineOffset,
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
  const updateFollowing = useCallback((next: boolean) => {
    followingRef.current = next;
    followTimelineRef.current = next;
    setIsFollowingTimeline((current) => (current === next ? current : next));
  }, []);
  const markProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = true;
    if (programmaticCooldownRef.current) clearTimeout(programmaticCooldownRef.current);
    programmaticCooldownRef.current = setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticCooldownRef.current = null;
    }, 350);
  }, []);
  const userTakesOverScroll = useCallback(() => {
    programmaticScrollRef.current = false;
    if (programmaticCooldownRef.current) {
      clearTimeout(programmaticCooldownRef.current);
      programmaticCooldownRef.current = null;
    }
  }, []);
  const userIntentExitFollow = useCallback(() => {
    const element = scrollRef.current;
    // Assigning the current value cancels an in-flight smooth scroll without
    // changing the visible position. The next streaming rAF sees followingRef
    // immediately and skips its pending scrollTo.
    if (element && typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollTop, behavior: 'auto' });
    }
    if (timelineScrollRafRef.current !== null) {
      cancelAnimationFrame(timelineScrollRafRef.current);
      timelineScrollRafRef.current = null;
    }
    userNavigatedTimelineRef.current = true;
    updateFollowing(false);
  }, [updateFollowing]);
  const clearUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = false;
    if (userScrollIntentTimerRef.current !== undefined) {
      clearTimeout(userScrollIntentTimerRef.current);
      userScrollIntentTimerRef.current = undefined;
    }
  }, []);
  const markUserScrollIntent = useCallback(() => {
    cancelLocationRef.current?.();
    invalidateHistoryAnchor();
    userNavigatedTimelineRef.current = true;
    userScrollIntentRef.current = true;
    if (userScrollIntentTimerRef.current !== undefined) {
      clearTimeout(userScrollIntentTimerRef.current);
    }
    userScrollIntentTimerRef.current = setTimeout(() => {
      userScrollIntentRef.current = false;
      userScrollIntentTimerRef.current = undefined;
    }, 240);
  }, [invalidateHistoryAnchor]);
  useEffect(() => {
    initialFollowPendingRef.current = true;
    followingRef.current = true;
    followTimelineRef.current = true;
    userNavigatedTimelineRef.current = false;
    clearUserScrollIntent();
    setIsFollowingTimeline(true);
    setUnreadCount(0);
    setTimelineWindowStart(0);
    lastStreamingScrollHeightRef.current = 0;
  }, [clearUserScrollIntent, session.id]);
  useEffect(() => clearUserScrollIntent, [clearUserScrollIntent]);
  useEffect(
    () => () => {
      if (programmaticCooldownRef.current) clearTimeout(programmaticCooldownRef.current);
      if (timelineScrollRafRef.current !== null) cancelAnimationFrame(timelineScrollRafRef.current);
    },
    [],
  );
  useEffect(() => {
    const previous = savedWatermark.current;
    if (previous.sessionId !== session.id) {
      savedWatermark.current = { sessionId: session.id, sequence: latestSavedSequence };
      setUnreadCount(0);
      return;
    }
    // History prepends, tools and stream reconciliation are not new messages.
    // An initial load establishes the watermark rather than an unread backlog.
    if (!isFollowingTimeline && previous.sequence > 0) {
      const added = new Set(
        (messages.data ?? [])
          .filter(
            (message) =>
              (message.sequence ?? 0) > previous.sequence &&
              (message.role === 'USER' || message.role === 'ASSISTANT'),
          )
          .map((message) => message.id),
      ).size;
      if (added) setUnreadCount((count) => count + added);
    }
    if (isFollowingTimeline) setUnreadCount(0);
    savedWatermark.current = {
      sessionId: session.id,
      sequence: Math.max(previous.sequence, latestSavedSequence),
    };
  }, [isFollowingTimeline, latestSavedSequence, messages.data, session.id]);
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
    let smoothTailFrame: number | undefined;
    const cancelPendingScroll = () => {
      if (trailingFrame !== undefined) cancelAnimationFrame(trailingFrame);
      if (smoothTailFrame !== undefined) cancelAnimationFrame(smoothTailFrame);
    };
    const scrollToLatest = () => {
      const element = scrollRef.current;
      if (
        !element ||
        element.clientHeight <= 0 ||
        userScrollIntentRef.current ||
        !followingRef.current
      )
        return;
      initialFollowPendingRef.current = false;
      smoothTailFrame = followStreamingBottom(
        element,
        lastStreamingScrollHeightRef,
        followingRef,
        markProgrammaticScroll,
      );
    };
    const scheduleScroll = () => {
      if (!followTimelineRef.current || userScrollIntentRef.current) return;
      cancelPendingScroll();
      trailingFrame = requestAnimationFrame(() => {
        trailingFrame = requestAnimationFrame(scrollToLatest);
      });
    };
    scheduleScroll();
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return () => {
        cancelPendingScroll();
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
      cancelPendingScroll();
    };
  }, [displayTurns.length, latestTimelineId, markProgrammaticScroll, session.id, viewportMeasured]);
  const scheduleLatestScroll = () => {
    if (timelineScrollRafRef.current !== null) cancelAnimationFrame(timelineScrollRafRef.current);
    timelineScrollRafRef.current = requestAnimationFrame(() => {
      timelineScrollRafRef.current = requestAnimationFrame(() => {
        timelineScrollRafRef.current = null;
        const element = scrollRef.current;
        if (
          element &&
          followingRef.current &&
          !userScrollIntentRef.current &&
          element.clientHeight > 0
        ) {
          initialFollowPendingRef.current = false;
          markProgrammaticScroll();
          element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
        }
      });
    });
  };
  // Query completion is not a React commit. Start correction only when the
  // requested older rows have reached this view, then follow that one version's
  // virtual measurements. Three stable frame samples avoid stopping between
  // ResizeObserver/virtualizer commits; 12 samples bound ownership (~200ms at
  // 60Hz). This is not a guarantee for fonts/media resolving after that budget.
  const sampleCommittedAnchor = useCallback(() => {
    historyFrameRef.current = null;
    const anchor = committedAnchorRef.current;
    const element = scrollRef.current;
    if (!anchor?.data || !element || !anchor.valid()) {
      clearCommittedAnchor();
      return;
    }
    const height = element.scrollHeight;
    anchor.stable = height === anchor.measuredHeight ? anchor.stable + 1 : 0;
    anchor.measuredHeight = height;
    markProgrammaticScroll();
    element.scrollTop = height - anchor.height + anchor.top;
    anchor.samples += 1;
    if (anchor.stable >= 3 || anchor.samples >= 12) {
      clearCommittedAnchor();
      historyFrameRef.current = null;
      return;
    }
    historyFrameRef.current = requestAnimationFrame(sampleCommittedAnchor);
  }, [clearCommittedAnchor, markProgrammaticScroll]);
  useLayoutEffect(() => {
    const anchor = committedAnchorRef.current;
    if (!anchor) return;
    const newest = Math.max(...(messages.data ?? []).map((message) => message.sequence));
    if (
      !anchor.valid() ||
      newest !== anchor.newest ||
      anchor.events !== events.data ||
      (anchor.data && anchor.data !== messages.data)
    ) {
      clearCommittedAnchor();
      return;
    }
    const oldest = Math.min(...(messages.data ?? []).map((message) => message.sequence));
    if (
      !anchor.data &&
      (anchor.remote ? oldest >= anchor.oldest : renderWindowStart >= anchor.windowStart)
    )
      return;
    if (!anchor.data) {
      anchor.data = messages.data;
      clearTimeout(anchor.expiry);
    }
    // Apply at the actual commit, not a guessed number of frames after fetch.
    // Count stability only on real frame callbacks, not incidental React renders.
    const element = scrollRef.current;
    if (!element) return;
    if (element.scrollHeight !== anchor.measuredHeight) anchor.stable = 0;
    anchor.measuredHeight = element.scrollHeight;
    markProgrammaticScroll();
    element.scrollTop = element.scrollHeight - anchor.height + anchor.top;
    if (historyFrameRef.current === null)
      historyFrameRef.current = requestAnimationFrame(sampleCommittedAnchor);
  });
  const preserveScrollAnchor = (
    previousHeight: number,
    previousTop: number,
    valid: () => boolean,
  ) => {
    if (!valid()) return;
    historyFrameRef.current = requestAnimationFrame(() => {
      historyFrameRef.current = null;
      const current = scrollRef.current;
      if (current && valid()) {
        markProgrammaticScroll();
        current.scrollTop = current.scrollHeight - previousHeight + previousTop;
      }
    });
  };
  const loadPreviousMessages = async () => {
    if (!historyAuthorizedRef.current || messages.isNavigatingHistory) return;
    const canRevealOlderWindow = renderWindowStart > 0;
    // Reveal already loaded rows first. A local window commit and a network
    // page have independent failure/commit lifecycles and must not share a click.
    const canFetchPrevious = Boolean(
      !canRevealOlderWindow &&
      hasPreviousMessages &&
      onLoadPreviousMessages &&
      !isLoadingPreviousMessages,
    );
    if ((!canFetchPrevious && !canRevealOlderWindow) || loadingPreviousRef.current) return;
    // Explicit history reading owns the scroll now, even if invoked while the
    // initial follow animation or a ResizeObserver tail frame is still queued.
    // Cancelling smooth scroll can synchronously emit scroll in embedded hosts.
    invalidateHistoryAnchor();
    markProgrammaticScroll();
    userIntentExitFollow();
    initialFollowPendingRef.current = false;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    const owner = Symbol('history-page');
    const generation = historyGenerationRef.current;
    const intent = historyIntentRef.current;
    const valid = () =>
      historyGenerationRef.current === generation &&
      historyIntentRef.current === intent &&
      scrollRef.current === element;
    loadingPreviousRef.current = owner;
    clearCommittedAnchor();
    const oldest = Math.min(...(messages.data ?? []).map((message) => message.sequence));
    const ownsCommittedAnchor =
      (canFetchPrevious || canRevealOlderWindow) && Number.isFinite(oldest);
    if (ownsCommittedAnchor) {
      const anchor = {
        oldest,
        windowStart: renderWindowStart,
        remote: canFetchPrevious,
        newest: Math.max(...(messages.data ?? []).map((message) => message.sequence)),
        height: previousHeight,
        top: previousTop,
        valid,
        events: events.data,
        stable: 0,
        samples: 0,
        measuredHeight: previousHeight,
      };
      committedAnchorRef.current = anchor;
    }
    try {
      if (canRevealOlderWindow)
        setTimelineWindowStart((current) =>
          Math.max(
            0,
            (current === 0 ? effectiveTimelineWindowStart : current) - CONVERSATION_WINDOW_STEP,
          ),
        );
      if (canFetchPrevious) await onLoadPreviousMessages?.();
    } catch {
      // Query state owns the visible error. Never leak a rejected click promise.
      if (valid()) clearCommittedAnchor();
    } finally {
      if (!ownsCommittedAnchor) preserveScrollAnchor(previousHeight, previousTop, valid);
      const anchor = committedAnchorRef.current;
      if (ownsCommittedAnchor && anchor && valid() && !anchor.data) {
        // Allow the completed query's notification to commit, but do not retain
        // abandoned ownership forever. Expiry never initiates a delayed scroll.
        anchor.expiry = setTimeout(() => {
          if (committedAnchorRef.current === anchor) clearCommittedAnchor();
        }, 2000);
      }
      if (loadingPreviousRef.current === owner) loadingPreviousRef.current = null;
    }
  };
  const jumpToLatest = () => {
    cancelLocationRef.current?.();
    invalidateHistoryAnchor();
    initialFollowPendingRef.current = false;
    clearUserScrollIntent();
    updateFollowing(true);
    setUnreadCount(0);
    setTimelineWindowStart(latestWindowStart);
    scheduleLatestScroll();
  };
  useEffect(() => {
    if (messages.isNavigatingHistory) {
      invalidateHistoryAnchor();
      userIntentExitFollow();
      initialFollowPendingRef.current = false;
    }
  }, [messages.isNavigatingHistory, invalidateHistoryAnchor, userIntentExitFollow]);

  const locatorView = useRef({
    turns,
    renderWindowStart,
    renderWindowSize,
    shouldVirtualize,
    timelineVirtualizer,
  });
  locatorView.current = {
    turns,
    renderWindowStart,
    renderWindowSize,
    shouldVirtualize,
    timelineVirtualizer,
  };
  const consumedLocations = useRef(new WeakSet<MessageLocationRequest>());
  const clearLocationHighlight = useRef<() => void>(() => {});
  useEffect(() => () => clearLocationHighlight.current(), [session.id]);
  useEffect(() => {
    const request = locationRequest;
    if (
      !request ||
      consumedLocations.current.has(request) ||
      request.target.sessionId !== session.id ||
      request.signal.aborted
    )
      return;
    clearLocationHighlight.current();
    let completed = false;
    const finish = (error?: Error) => {
      consumedLocations.current.add(request);
      completed = !error;
      if (error) request.complete(error);
      else request.complete();
    };
    const generation = historyGenerationRef.current;
    let cancelled = false;
    let frame: number | undefined;
    let attempts = 0;
    let scrolledIndex: number | undefined;

    const valid = () =>
      !cancelled &&
      !request.signal.aborted &&
      historyAuthorizedRef.current &&
      historyGenerationRef.current === generation &&
      request.target.sessionId === session.id;
    const stop = () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
    request.signal.addEventListener('abort', stop, { once: true });
    invalidateHistoryAnchor();
    userIntentExitFollow();
    initialFollowPendingRef.current = false;
    const intent = historyIntentRef.current;
    const locate = () => {
      if (historyIntentRef.current !== intent && valid()) {
        finish(new Error('定位已取消，已保留你的滚动位置。'));
        return;
      }
      if (!valid()) return;
      const view = locatorView.current;
      const index = view.turns.findIndex((turn) =>
        turn.entries.some(
          (item) =>
            item.kind === 'message' &&
            item.persisted &&
            item.message.id === request.target.id &&
            item.message.sequence === request.target.sequence,
        ),
      );
      if (++attempts > 90) {
        finish(new Error('消息已加载，但未能确认可见位置；请重试定位。'));
        return;
      }
      if (index < 0) {
        frame = requestAnimationFrame(locate);
        return;
      }
      const desiredStart = Math.max(0, index - 5);
      if (
        index < view.renderWindowStart ||
        index >= view.renderWindowStart + view.renderWindowSize
      ) {
        setTimelineWindowStart(desiredStart);
        frame = requestAnimationFrame(locate);
        return;
      }
      const relative = index - view.renderWindowStart;
      if (view.shouldVirtualize && scrolledIndex !== relative) {
        markProgrammaticScroll();
        view.timelineVirtualizer.scrollToIndex(relative, { align: 'center', behavior: 'auto' });
        scrolledIndex = relative;
        frame = requestAnimationFrame(locate);
        return;
      }
      const root = scrollRef.current;
      const node =
        root &&
        Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (element) =>
            element.dataset.messageId === request.target.id &&
            element.dataset.messageSequence === String(request.target.sequence),
        );
      if (!root || !node) {
        if (attempts % 10 === 0) scrolledIndex = undefined;
        frame = requestAnimationFrame(locate);
        return;
      }
      const bounds = root.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      if (bounds.height <= 0 || box.height <= 0) {
        frame = requestAnimationFrame(locate);
        return;
      }
      if (
        box.bottom <= Math.max(0, bounds.top) ||
        box.top >= Math.min(innerHeight, bounds.bottom)
      ) {
        markProgrammaticScroll();
        root.scrollTo({ top: root.scrollTop + box.top - bounds.top - 24, behavior: 'auto' });
        frame = requestAnimationFrame(locate);
        return;
      }
      if (!valid()) return;
      node.focus({ preventScroll: true });
      if (document.activeElement !== node) {
        frame = requestAnimationFrame(locate);
        return;
      }
      node.style.outline = '1px solid hsl(var(--primary) / 0.5)';
      node.style.outlineOffset = '-1px';
      node.dataset.messageLocated = 'true';
      const clearHighlight = () => {
        clearTimeout(highlightTimer);
        node.style.removeProperty('outline');
        node.style.removeProperty('outline-offset');
        delete node.dataset.messageLocated;
      };
      const highlightTimer = setTimeout(clearHighlight, 2400);
      clearLocationHighlight.current = clearHighlight;
      finish();
    };
    frame = requestAnimationFrame(locate);
    return () => {
      stop();
      request.signal.removeEventListener('abort', stop);
      if (!completed) clearLocationHighlight.current();
    };
  }, [
    locationRequest,
    session.id,
    invalidateHistoryAnchor,
    userIntentExitFollow,
    markProgrammaticScroll,
  ]);

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
    onOpenFile,
    onOpenDiff,
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
          className="conversation-scroll h-full overflow-y-auto overscroll-contain px-0.5 py-2 sm:px-1 sm:py-3"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          onWheel={(event) => {
            // wheel/touch input is authoritative user intent. Clear the
            // programmatic cooldown before checking history so a smooth
            // streaming scroll cannot reclaim control in the same frame.
            userTakesOverScroll();
            markUserScrollIntent();
            if (event.deltaY < 0) userIntentExitFollow();
          }}
          onPointerDown={(event) => {
            // Content clicks (for example expanding thought/tool details) must
            // not be mistaken for a scrollbar drag and break follow mode.
            if (event.target === event.currentTarget) {
              userTakesOverScroll();
              markUserScrollIntent();
            }
          }}
          onTouchStart={(event) => {
            touchStartYRef.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(event) => {
            userTakesOverScroll();
            markUserScrollIntent();
            const startY = touchStartYRef.current;
            const currentY = event.touches[0]?.clientY;
            if (startY !== null && currentY !== undefined && currentY - startY > 6) {
              userIntentExitFollow();
            }
          }}
          onTouchEnd={() => {
            touchStartYRef.current = null;
          }}
          onKeyDown={(event) => {
            if (
              ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)
            ) {
              userTakesOverScroll();
              markUserScrollIntent();
              if (
                event.key === 'ArrowUp' ||
                event.key === 'PageUp' ||
                event.key === 'Home' ||
                (event.key === ' ' && event.shiftKey)
              ) {
                userIntentExitFollow();
              }
            }
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            if (programmaticScrollRef.current) return;
            const nextFollowing =
              element.scrollHeight - element.scrollTop - element.clientHeight < 120;
            const userInitiated = userScrollIntentRef.current;
            if (userInitiated) clearUserScrollIntent();
            if (!userInitiated && initialFollowPendingRef.current && !nextFollowing) return;
            if (initialFollowPendingRef.current) initialFollowPendingRef.current = false;
            updateFollowing(nextFollowing);
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
            <div
              className={
                approvalFeedback.tone === 'attention'
                  ? 'workspace-query-error'
                  : approvalFeedback.tone === 'confirmed'
                    ? 'workspace-query-status'
                    : 'approval-delivery-status'
              }
              role={approvalFeedback.tone === 'attention' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {approvalFeedback.message}
              {deliveryReadError && (
                <button type="button" disabled={deliveryChecking} onClick={retryDeliveryRead}>
                  重新查询投递状态
                </button>
              )}
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
        <div className="conversation-latest-dock flex shrink-0 justify-center border-t border-[hsl(var(--border))]">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-xs text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--surface-muted))]"
            aria-label="回到最新"
            onClick={jumpToLatest}
          >
            <ChevronDown size={14} aria-hidden="true" />
            回到最新
            {unreadCount > 0 && <span>{unreadCount} 条新消息</span>}
          </button>
        </div>
      )}
      {composer && (session.status !== 'CLOSED' || Boolean(activeRun)) ? (
        <div className="chat-composer-dock relative shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom),var(--mobile-keyboard-inset,0px))] pt-1 before:pointer-events-none before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-gradient-to-t before:from-[hsl(var(--background))]/85 before:to-transparent sm:px-4 sm:pb-3 sm:pt-2 sm:before:-top-5 sm:before:h-5">
          {composer}
        </div>
      ) : null}
    </section>
  );
});

ChatConversationView.displayName = 'ChatConversationView';

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
  const assistantCopyText = assistantEntries
    .filter(
      (item) =>
        item.kind === 'message' &&
        item.message.role === 'ASSISTANT' &&
        !item.streaming &&
        Boolean(item.copyText ?? item.message.text?.trim()),
    )
    .map((item) => (item.kind === 'message' ? (item.copyText ?? item.message.text?.trim()) : ''))
    .filter((text): text is string => Boolean(text))
    .join('\n\n');
  const assistantStreaming = assistantEntries.some(
    (item) => item.kind === 'message' && item.message.role === 'ASSISTANT' && item.streaming,
  );
  return (
    <article
      className="conversation-turn min-w-0 px-0.5 py-1 animate-[hci-entry_var(--anim-entry-fast)_var(--ease-out-expo)_both] motion-reduce:animate-none"
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
              <ChatEntryRenderer key={item.id} item={item} {...itemProps} showActions={false} />
            ))}
            {assistantCopyText && !assistantStreaming ? (
              <ChatEntryActions text={assistantCopyText} />
            ) : null}
          </div>
        </section>
      )}
    </article>
  );
}
