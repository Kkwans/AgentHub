/**
 * ThreeColumnSplit — 自适应工作台布局
 *
 * 宽屏显示可拖拽三栏，中等窗口显示辅助栏与常驻主栏，窄屏显示单面板标签。
 * 共享组件，供 RunDetailPage 和 ProjectDetailPage 使用。
 */

import { ChevronLeft, ChevronRight, GripVertical } from '@agenthub/ui';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../ui/cn';

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Layout preferences are best effort and must never block resizing.
  }
}

const SINGLE_PANEL_BREAKPOINT = 768;
// PinHarness keeps the three-column workbench once the viewport can hold the
// 256px rail, 560px conversation and a compact inspector. Below this point the
// conversation remains the primary surface and the auxiliary panels become a
// switchable drawer.
const WIDE_LAYOUT_BREAKPOINT = 1180;
const MIN_MIDDLE_WIDTH = 560;
const MAX_LEFT_WIDTH = 380;
const MAX_RIGHT_WIDTH = 520;

export type CompactPanel = 'left' | 'middle' | 'right';
export type ThreeColumnLayoutMode = 'single' | 'medium' | 'wide';

export function resolveThreeColumnLayoutMode(width: number): ThreeColumnLayoutMode | null {
  if (width <= 0) return null;
  if (width < SINGLE_PANEL_BREAKPOINT) return 'single';
  if (width < WIDE_LAYOUT_BREAKPOINT) return 'medium';
  return 'wide';
}

// ─── 工具 ─────────────────────────────────────────────────────────

export function readRatio(key: string, defaultV: number, min: number, max: number): number {
  const raw = lsGet(key);
  if (!raw) return defaultV;
  const v = Number.parseFloat(raw);
  if (Number.isNaN(v)) return defaultV;
  return Math.min(max, Math.max(min, v));
}

// ─── Props ────────────────────────────────────────────────────────

export interface ThreeColumnSplitProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onOpenLeft: () => void;
  onOpenRight: () => void;
  /** 左栏折叠时边缘 tab 显示的标签文字 */
  leftLabel: string;
  /** 右栏折叠时边缘 tab 显示的标签文字，默认“工作区” */
  rightLabel?: string;
  /** compact 模式下中栏 tab 显示的标签文字，默认"详情" */
  middleLabel?: string;
  /**
   * compact 模式下初始激活的面板，默认 'middle'。
   * 供调用方按自身语义决定首屏优先展示哪一栏（如手机端优先展示状态概览而非详情），
   * 组件本身不关心具体业务含义。
   */
  defaultCompactPanel?: CompactPanel;
  /** compact 模式激活面板（可选受控值，便于业务动作跨面板导航） */
  compactPanel?: CompactPanel;
  /** compact 模式面板切换回调 */
  onCompactPanelChange?: (panel: CompactPanel) => void;
  /** compact 模式 Tab 顺序；默认详情、左栏、右栏 */
  compactPanelOrder?: CompactPanel[];
  /** 实际容器宽度对应的布局模式变化 */
  onLayoutModeChange?: (mode: ThreeColumnLayoutMode) => void;
  /** localStorage key：左栏宽度比例 */
  leftRatioKey: string;
  /** localStorage key：右栏宽度比例 */
  rightRatioKey: string;
  /** 左栏初始宽度比例，默认 0.22 */
  leftRatioDefault?: number;
  /** 右栏初始宽度比例，默认 0.38 */
  rightRatioDefault?: number;
  /** Optional explicit mode for tests and embedded mobile workbenches. */
  layoutMode?: ThreeColumnLayoutMode | 'auto';
  className?: string;
}

type CompactTabs = Record<CompactPanel, { label: string; open: () => void }>;

function CompactThreeColumnLayout({
  activePanel,
  panel,
  order,
  tabs,
  onKeyDown,
}: {
  activePanel: CompactPanel;
  panel: React.ReactNode;
  order: CompactPanel[];
  tabs: CompactTabs;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="three-column-compact-shell relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface))] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div
        role="tablist"
        aria-label="Workspace 视图"
        onKeyDown={onKeyDown}
        className="three-column-compact-tabs workspace-mobile-tabs grid shrink-0 grid-cols-3 items-center gap-1 border-b border-[hsl(var(--border))]/60 bg-[hsl(var(--surface))]/95 p-1.5"
      >
        {order.map((panelId) => {
          const tab = tabs[panelId];
          const selected = activePanel === panelId;
          return (
            <button
              key={panelId}
              role="tab"
              id={`compact-tab-${panelId}`}
              aria-selected={selected}
              aria-controls={`compact-panel-${panelId}`}
              data-compact-panel={panelId}
              tabIndex={selected ? 0 : -1}
              type="button"
              onClick={tab.open}
              className={cn(
                'three-column-compact-tab flex min-h-11 min-w-0 items-center justify-center rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150',
                selected
                  ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] shadow-[0_1px_2px_hsl(var(--primary)/0.1)]'
                  : 'text-[hsl(var(--foreground-subtle))] hover:bg-[hsl(var(--surface-muted))] hover:text-[hsl(var(--foreground))]',
              )}
            >
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div
        key={activePanel}
        id={`compact-panel-${activePanel}`}
        role="tabpanel"
        aria-labelledby={`compact-tab-${activePanel}`}
        className="three-column-compact-panel min-h-0 flex-1 overflow-hidden animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
      >
        {panel}
      </div>
    </div>
  );
}

function MediumThreeColumnLayout({
  sideWidth,
  sidePanel,
  sideOpen,
  tabs,
  left,
  middle,
  right,
  onOpen,
  onKeyDown,
}: {
  sideWidth: number;
  sidePanel: 'left' | 'right';
  sideOpen: boolean;
  tabs: CompactTabs;
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  onOpen: (panel: CompactPanel) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  if (!sideOpen) {
    return (
      <>
        <div className="h-full min-w-0 overflow-hidden">{middle}</div>
        {/*
         * Keep the session rail mounted in a clipped accessibility tree while
         * the medium layout is conversation-first. This preserves current
         * session links for keyboard/screen-reader navigation and avoids
         * throwing away the user's loaded session list on a panel switch.
         */}
        <div className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0">
          {left}
        </div>
      </>
    );
  }
  return (
    <div
      className="grid h-full min-h-0 gap-3"
      style={{ gridTemplateColumns: `${sideWidth}px minmax(0, 1fr)` }}
    >
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface))]">
        <div
          role="tablist"
          aria-label="辅助栏视图"
          onKeyDown={onKeyDown}
          className="grid shrink-0 grid-cols-2 border-b border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/35"
        >
          {(['left', 'right'] as const).map((panelId) => {
            const selected = sidePanel === panelId;
            return (
              <button
                key={panelId}
                type="button"
                role="tab"
                id={`medium-tab-${panelId}`}
                aria-selected={selected}
                aria-controls={`medium-panel-${panelId}`}
                data-medium-panel={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => onOpen(panelId)}
                className={cn(
                  'relative min-h-10 min-w-0 px-3 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--primary))]/30',
                  selected
                    ? 'bg-[hsl(var(--surface))] text-[hsl(var(--primary))] after:absolute after:inset-x-6 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--foreground-subtle))] hover:bg-[hsl(var(--surface-muted))] hover:text-[hsl(var(--foreground))]',
                )}
              >
                <span className="block truncate">{tabs[panelId].label}</span>
              </button>
            );
          })}
        </div>
        <div
          id="medium-panel-left"
          role="tabpanel"
          aria-labelledby="medium-tab-left"
          hidden={sidePanel !== 'left'}
          className="three-column-medium-panel min-h-0 flex-1 overflow-hidden"
        >
          {left}
        </div>
        <div
          id="medium-panel-right"
          role="tabpanel"
          aria-labelledby="medium-tab-right"
          hidden={sidePanel !== 'right'}
          className="three-column-medium-panel min-h-0 flex-1 overflow-hidden"
        >
          {right}
        </div>
      </aside>
      <div className="h-full min-w-0 overflow-hidden">{middle}</div>
    </div>
  );
}

// ─── 组件 ─────────────────────────────────────────────────────────

export function ThreeColumnSplit({
  left,
  middle,
  right,
  leftCollapsed,
  rightCollapsed,
  onOpenLeft,
  onOpenRight,
  leftLabel,
  rightLabel = '工作区',
  middleLabel = '详情',
  defaultCompactPanel = 'middle',
  compactPanel: controlledCompactPanel,
  onCompactPanelChange,
  compactPanelOrder = ['middle', 'left', 'right'],
  onLayoutModeChange,
  leftRatioKey,
  rightRatioKey,
  leftRatioDefault = 0.22,
  rightRatioDefault = 0.38,
  layoutMode: requestedLayoutMode = 'auto',
  className,
}: ThreeColumnSplitProps) {
  const [leftRatio, setLeftRatio] = useState(() =>
    readRatio(leftRatioKey, leftRatioDefault, 0.12, 0.45),
  );
  const [rightRatio, setRightRatio] = useState(() =>
    readRatio(rightRatioKey, rightRatioDefault, 0.18, 0.5),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingHandle = useRef<'L' | 'R' | null>(null);
  const draggingPointerId = useRef<number | null>(null);
  const [internalCompactPanel, setInternalCompactPanel] =
    useState<CompactPanel>(defaultCompactPanel);
  const activeCompactPanel = controlledCompactPanel ?? internalCompactPanel;
  const setActiveCompactPanel = useCallback(
    (panel: CompactPanel) => {
      setInternalCompactPanel(panel);
      onCompactPanelChange?.(panel);
    },
    [onCompactPanelChange],
  );
  const [activeHandle, setActiveHandle] = useState<'L' | 'R' | null>(null);
  // 用 ref 镜像最新值，让 drag handler 始终能读到当前状态，
  // 同时避免 useEffect 因依赖变化每次拖动都重新注册/注销 document 监听器。
  const leftRatioRef = useRef(leftRatio);
  const rightRatioRef = useRef(rightRatio);
  const leftCollapsedRef = useRef(leftCollapsed);
  const rightCollapsedRef = useRef(rightCollapsed);
  const leftRatioKeyRef = useRef(leftRatioKey);
  const rightRatioKeyRef = useRef(rightRatioKey);
  leftRatioRef.current = leftRatio;
  rightRatioRef.current = rightRatio;
  leftCollapsedRef.current = leftCollapsed;
  rightCollapsedRef.current = rightCollapsed;
  leftRatioKeyRef.current = leftRatioKey;
  rightRatioKeyRef.current = rightRatioKey;

  const onPointerDownLeft = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    draggingHandle.current = 'L';
    draggingPointerId.current = event.pointerId;
    setActiveHandle('L');
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPointerDownRight = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    draggingHandle.current = 'R';
    draggingPointerId.current = event.pointerId;
    setActiveHandle('R');
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: drag resize handler
    function move(e: PointerEvent) {
      if (
        !draggingHandle.current ||
        draggingPointerId.current !== e.pointerId ||
        !containerRef.current
      ) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const xRatio = (e.clientX - rect.left) / rect.width;
      const usableWidth = Math.max(1, rect.width - 24);
      const maxCombinedRatio = Math.max(0.45, 1 - MIN_MIDDLE_WIDTH / usableWidth);
      if (draggingHandle.current === 'L') {
        const next = Math.min(0.45, Math.max(0.12, xRatio));
        if (
          !rightCollapsedRef.current &&
          next + rightRatioRef.current > maxCombinedRatio &&
          next >= leftRatioRef.current
        ) {
          return;
        }
        leftRatioRef.current = next;
        setLeftRatio(next);
      } else {
        const next = Math.min(0.5, Math.max(0.18, 1 - xRatio));
        if (
          !leftCollapsedRef.current &&
          leftRatioRef.current + next > maxCombinedRatio &&
          next >= rightRatioRef.current
        ) {
          return;
        }
        rightRatioRef.current = next;
        setRightRatio(next);
      }
    }
    function up(e: PointerEvent) {
      if (draggingPointerId.current !== e.pointerId) return;
      if (draggingHandle.current === 'L')
        lsSet(leftRatioKeyRef.current, String(leftRatioRef.current));
      else if (draggingHandle.current === 'R')
        lsSet(rightRatioKeyRef.current, String(rightRatioRef.current));
      draggingHandle.current = null;
      draggingPointerId.current = null;
      setActiveHandle(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      draggingHandle.current = null;
      draggingPointerId.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // 空依赖数组：handlers 通过 ref 读取最新值，mount 时注册一次即可
  }, []);

  // containerWidth 用于把 ratio 换算成绝对 px，这样所有列单位统一，CSS 才能平滑插值
  const [containerWidth, setContainerWidth] = useState(0);
  /**
   * 首次布局前同步测量容器，避免窄窗口先渲染三栏再跳到自适应布局。
   * 首次测量不播放列宽动画，后续用户拖拽时才启用过渡。
   */
  const [transitionEnabled, setTransitionEnabled] = useState(false);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let firstMeasure = true;
    let transitionFrame = 0;
    const updateWidth = (width: number) => {
      setContainerWidth(width);
      if (!firstMeasure) return;
      firstMeasure = false;
      transitionFrame = requestAnimationFrame(() => setTransitionEnabled(true));
    };
    const measuredWidth = container.getBoundingClientRect().width;
    updateWidth(measuredWidth || (typeof window !== 'undefined' ? window.innerWidth : 1440));
    const ro = new ResizeObserver(([entry]) => {
      const width =
        entry?.contentRect.width || (typeof window !== 'undefined' ? window.innerWidth : 1440);
      updateWidth(width);
    });
    ro.observe(container);
    return () => {
      cancelAnimationFrame(transitionFrame);
      ro.disconnect();
    };
  }, []);

  const measuredLayoutMode = resolveThreeColumnLayoutMode(containerWidth);
  const layoutMode = requestedLayoutMode === 'auto' ? measuredLayoutMode : requestedLayoutMode;
  const previousLayoutModeRef = useRef<ThreeColumnLayoutMode | null>(null);
  const previousDefaultPanelRef = useRef(defaultCompactPanel);

  useLayoutEffect(() => {
    if (layoutMode) onLayoutModeChange?.(layoutMode);
  }, [layoutMode, onLayoutModeChange]);

  useEffect(() => {
    if (!layoutMode) return;
    const previousMode = previousLayoutModeRef.current;
    const defaultPanelChanged = previousDefaultPanelRef.current !== defaultCompactPanel;
    previousLayoutModeRef.current = layoutMode;
    previousDefaultPanelRef.current = defaultCompactPanel;

    if (layoutMode === 'single' && (previousMode !== 'single' || defaultPanelChanged)) {
      setActiveCompactPanel(defaultCompactPanel);
      return;
    }
  }, [
    layoutMode,
    defaultCompactPanel,
    activeCompactPanel,
    controlledCompactPanel,
    setActiveCompactPanel,
  ]);

  const openAdaptivePanel = useCallback(
    (panel: CompactPanel) => setActiveCompactPanel(panel),
    [setActiveCompactPanel],
  );

  const HANDLE_W = 12;
  // 折叠时手柄也隐藏（0px），展开时才保留
  const lHandleW = leftCollapsed ? 0 : HANDLE_W;
  const rHandleW = rightCollapsed ? 0 : HANDLE_W;
  const totalHandles = lHandleW + rHandleW;
  const usable = Math.max(0, containerWidth - totalHandles);
  const desiredLeftPx = leftCollapsed ? 0 : Math.min(MAX_LEFT_WIDTH, leftRatio * usable);
  const desiredRightPx = rightCollapsed ? 0 : Math.min(MAX_RIGHT_WIDTH, rightRatio * usable);
  const desiredSideWidth = desiredLeftPx + desiredRightPx;
  const maxSideWidth = Math.max(0, usable - MIN_MIDDLE_WIDTH);
  const sideScale = desiredSideWidth > maxSideWidth ? maxSideWidth / desiredSideWidth : 1;
  const leftPx = Math.round(desiredLeftPx * sideScale);
  const rightPx = Math.round(desiredRightPx * sideScale);
  const gridCols = `${leftPx}px ${lHandleW}px minmax(${MIN_MIDDLE_WIDTH}px, 1fr) ${rHandleW}px ${rightPx}px`;

  const compactPanel =
    activeCompactPanel === 'left' ? left : activeCompactPanel === 'right' ? right : middle;
  const compactTabs: Record<CompactPanel, { label: string; open: () => void }> = {
    left: { label: leftLabel, open: () => openAdaptivePanel('left') },
    middle: { label: middleLabel, open: () => openAdaptivePanel('middle') },
    right: { label: rightLabel, open: () => openAdaptivePanel('right') },
  };
  const mediumPanel = activeCompactPanel === 'right' ? 'right' : 'left';
  const mediumSideWidth = Math.min(340, Math.max(240, Math.round(containerWidth * 0.28)));

  const handleSeparatorKeyDown = useCallback(
    (side: 'L' | 'R', event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const usableWidth = Math.max(
        1,
        (containerRef.current?.getBoundingClientRect().width ?? 0) - 24,
      );
      const maxCombinedRatio = Math.max(0.45, 1 - MIN_MIDDLE_WIDTH / usableWidth);

      if (side === 'L') {
        const upperBound = rightCollapsed
          ? 0.45
          : Math.max(0.12, Math.min(0.45, maxCombinedRatio - rightRatioRef.current));
        const next =
          event.key === 'Home'
            ? 0.12
            : event.key === 'End'
              ? upperBound
              : Math.min(upperBound, Math.max(0.12, leftRatioRef.current + direction * 0.02));
        leftRatioRef.current = next;
        setLeftRatio(next);
        lsSet(leftRatioKeyRef.current, String(next));
        return;
      }

      const upperBound = leftCollapsed
        ? 0.5
        : Math.max(0.18, Math.min(0.5, maxCombinedRatio - leftRatioRef.current));
      const next =
        event.key === 'Home'
          ? 0.18
          : event.key === 'End'
            ? upperBound
            : Math.min(upperBound, Math.max(0.18, rightRatioRef.current - direction * 0.02));
      rightRatioRef.current = next;
      setRightRatio(next);
      lsSet(rightRatioKeyRef.current, String(next));
    },
    [leftCollapsed, rightCollapsed],
  );

  function handleCompactTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = compactPanelOrder.indexOf(activeCompactPanel);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? compactPanelOrder.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + compactPanelOrder.length) %
            compactPanelOrder.length;
    const nextPanel = compactPanelOrder[nextIndex];
    if (!nextPanel) return;
    compactTabs[nextPanel].open();
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLButtonElement>(`[data-compact-panel="${nextPanel}"]`)
        ?.focus();
    });
  }

  function handleMediumTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextPanel = event.key === 'ArrowRight' || event.key === 'End' ? 'right' : 'left';
    openAdaptivePanel(nextPanel);
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLButtonElement>(`[data-medium-panel="${nextPanel}"]`)
        ?.focus();
    });
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'three-column-split h-full min-h-0 w-full',
        layoutMode === 'single' && 'three-column-split--compact',
        layoutMode === 'medium' && 'three-column-split--medium',
        activeHandle && 'select-none',
        className,
      )}
      style={
        layoutMode === 'wide'
          ? {
              display: 'grid',
              gridTemplateColumns: gridCols,
              gridTemplateRows: '1fr',
              gap: 0,
              transition:
                transitionEnabled && !activeHandle
                  ? 'grid-template-columns 180ms cubic-bezier(0.4,0,0.2,1)'
                  : 'none',
            }
          : layoutMode === null
            ? { visibility: 'hidden' }
            : undefined
      }
    >
      {layoutMode === 'single' ? (
        <CompactThreeColumnLayout
          activePanel={activeCompactPanel}
          panel={compactPanel}
          order={compactPanelOrder}
          tabs={compactTabs}
          onKeyDown={handleCompactTabKeyDown}
        />
      ) : layoutMode === 'medium' ? (
        <MediumThreeColumnLayout
          sideWidth={mediumSideWidth}
          sidePanel={mediumPanel}
          sideOpen={activeCompactPanel !== 'middle'}
          tabs={compactTabs}
          left={left}
          middle={middle}
          right={right}
          onOpen={openAdaptivePanel}
          onKeyDown={handleMediumTabKeyDown}
        />
      ) : layoutMode === 'wide' ? (
        <>
          {/* 左栏：折叠时不渲染，grid-column 已经是 0px */}
          <div className="h-full min-w-0 overflow-hidden">{!leftCollapsed && left}</div>

          {/* L|M 拖拽手柄：折叠时 grid 已给 0px，pointer-events 关闭 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={12}
            aria-valuemax={45}
            aria-valuenow={Math.round(leftRatio * 100)}
            aria-valuetext={`左栏宽度 ${leftPx} 像素`}
            tabIndex={leftCollapsed ? -1 : 0}
            onPointerDown={onPointerDownLeft}
            onKeyDown={(event) => handleSeparatorKeyDown('L', event)}
            aria-label="调整左栏宽度"
            className={cn(
              'group relative h-full w-full cursor-col-resize touch-none bg-transparent outline-none focus-visible:bg-[hsl(var(--primary))]/5',
              activeHandle === 'L' && 'z-20',
            )}
            style={{ pointerEvents: leftCollapsed ? 'none' : 'auto' }}
          >
            <span
              className={cn(
                'absolute left-1/2 inset-y-[12%] -translate-x-1/2 rounded-full bg-[hsl(var(--border))]/65 transition-[width,background-color,box-shadow] duration-200 group-hover:w-[3px] group-hover:bg-[hsl(var(--primary))]/45',
                activeHandle === 'L'
                  ? 'w-[3px] bg-[hsl(var(--primary))]/75 shadow-[0_0_12px_hsl(var(--primary)/0.28)]'
                  : 'w-px',
              )}
            />
            <GripVertical className="absolute left-1/2 top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2 rounded bg-[hsl(var(--surface-elevated))] p-0.5 text-[hsl(var(--foreground-faint))] opacity-0 shadow-sm ring-1 ring-[hsl(var(--border))]/70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </div>

          {/* 中栏：相对定位，用于挂载展开 tab */}
          <div className="relative h-full min-w-0 overflow-hidden">
            {middle}
            {/* 左侧折叠后的展开 tab（贴左边缘，垂直居中） */}
            {leftCollapsed && (
              <button
                type="button"
                onClick={onOpenLeft}
                title={`展开 ${leftLabel}`}
                aria-label={`展开 ${leftLabel}`}
                className="mobile-touch-target absolute left-0 top-1/2 z-10 -translate-y-1/2 flex flex-col items-center gap-1.5 rounded-r-lg border border-l-0 border-[hsl(var(--border))]/70 bg-[hsl(var(--surface))] px-1.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-colors hover:bg-[hsl(var(--surface-muted))]"
              >
                <ChevronRight className="h-3 w-3 text-[hsl(var(--primary))]/70" />
                <span className="[writing-mode:vertical-rl] text-[12px] font-medium tracking-widest text-[hsl(var(--foreground-subtle))] select-none">
                  {leftLabel}
                </span>
              </button>
            )}
            {/* 右侧折叠后的展开 tab（贴右边缘，垂直居中） */}
            {rightCollapsed && (
              <button
                type="button"
                onClick={onOpenRight}
                title={`展开 ${rightLabel}`}
                aria-label={`展开 ${rightLabel}`}
                className="mobile-touch-target absolute right-0 top-1/2 z-10 -translate-y-1/2 flex flex-col items-center gap-1.5 rounded-l-lg border border-r-0 border-[hsl(var(--border))]/70 bg-[hsl(var(--surface))] px-1.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-colors hover:bg-[hsl(var(--surface-muted))]"
              >
                <ChevronLeft className="h-3 w-3 text-[hsl(var(--primary))]/70" />
                <span className="[writing-mode:vertical-rl] text-[12px] font-medium tracking-widest text-[hsl(var(--foreground-subtle))] select-none">
                  {rightLabel}
                </span>
              </button>
            )}
          </div>

          {/* M|R 拖拽手柄：折叠时 grid 已给 0px，pointer-events 关闭 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={18}
            aria-valuemax={50}
            aria-valuenow={Math.round(rightRatio * 100)}
            aria-valuetext={`右栏宽度 ${rightPx} 像素`}
            tabIndex={rightCollapsed ? -1 : 0}
            onPointerDown={onPointerDownRight}
            onKeyDown={(event) => handleSeparatorKeyDown('R', event)}
            aria-label="调整右栏宽度"
            className={cn(
              'group relative h-full w-full cursor-col-resize touch-none bg-transparent outline-none focus-visible:bg-[hsl(var(--primary))]/5',
              activeHandle === 'R' && 'z-20',
            )}
            style={{ pointerEvents: rightCollapsed ? 'none' : 'auto' }}
          >
            <span
              className={cn(
                'absolute left-1/2 inset-y-[12%] -translate-x-1/2 rounded-full bg-[hsl(var(--border))]/65 transition-[width,background-color,box-shadow] duration-200 group-hover:w-[3px] group-hover:bg-[hsl(var(--primary))]/45',
                activeHandle === 'R'
                  ? 'w-[3px] bg-[hsl(var(--primary))]/75 shadow-[0_0_12px_hsl(var(--primary)/0.28)]'
                  : 'w-px',
              )}
            />
            <GripVertical className="absolute left-1/2 top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2 rounded bg-[hsl(var(--surface-elevated))] p-0.5 text-[hsl(var(--foreground-faint))] opacity-0 shadow-sm ring-1 ring-[hsl(var(--border))]/70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </div>

          {/* 右栏：折叠时不渲染 */}
          <div className="h-full min-w-0 overflow-hidden">{!rightCollapsed && right}</div>
        </>
      ) : null}
    </div>
  );
}
