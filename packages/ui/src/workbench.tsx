import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode, SyntheticEvent } from 'react';
import { useCallback, useState } from 'react';

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export type WorkbenchPanelSide = 'rail' | 'conversation' | 'inspector';
export type WorkbenchLayoutMode = 'auto' | 'wide' | 'medium' | 'single';
export type WorkbenchMotionState = 'idle' | 'entering' | 'active' | 'exiting';
export type WorkbenchStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'running';
export type WorkbenchExecutionState =
  'queued' | 'running' | 'success' | 'waiting' | 'error' | 'idle';

/**
 * Motion values are intentionally limited to opacity and transform so the
 * workbench never animates layout or causes a neighboring panel to reflow.
 * CSS owns the timing and reduced-motion fallback in styles.css.
 */
export const WORKBENCH_MOTION_VARIANTS = {
  idle: { opacity: 1, transform: 'translateY(0)' },
  entering: { opacity: 0, transform: 'translateY(4px)' },
  active: { opacity: 1, transform: 'translateY(0)' },
  exiting: { opacity: 0, transform: 'translateY(-2px)' },
} as const;

// Keep a screaming-capital alias for consumers that treat constants as
// design tokens, while retaining the readable name above for feature code.
export const AH_WORKBENCH_MOTION_VARIANTS = WORKBENCH_MOTION_VARIANTS;

export function workbenchMotionClass(state: WorkbenchMotionState): string {
  return `ah-motion-${state}`;
}

/**
 * Framework-neutral view types for a rendered conversation. They intentionally
 * contain view data only; provider, ACP and transport types stay in features.
 */
export type ConversationEntryKind =
  'user' | 'assistant' | 'thought' | 'tool' | 'approval' | 'status';

export interface ConversationEntryView {
  id: string;
  kind: ConversationEntryKind;
  content: ReactNode;
  timestamp?: ReactNode;
  state?: WorkbenchExecutionState;
  expandable?: boolean;
  defaultExpanded?: boolean;
}

export interface ConversationTurn {
  id: string;
  entries: readonly ConversationEntryView[];
  state?: WorkbenchExecutionState;
  complete?: boolean;
}

export interface WorkbenchProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  topbar?: ReactNode;
  rail?: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  terminal?: ReactNode;
  railCollapsed?: boolean;
  inspectorCollapsed?: boolean;
  inspectorOpen?: boolean;
  /** Optional explicit mode for embedded workbenches; auto keeps CSS-driven responsiveness. */
  layoutMode?: WorkbenchLayoutMode;
  /** Active panel used by medium/single layouts; desktop still renders all supplied slots. */
  activePanel?: WorkbenchPanelSide;
  /** Preserve the terminal slot while allowing the feature to close its dock. */
  terminalOpen?: boolean;
  terminalLabel?: string;
  labels?: Partial<Record<WorkbenchPanelSide, string>>;
}

/**
 * Structural workbench contract. It owns panel geometry and state attributes;
 * domain data and interactions stay with the feature that renders each slot.
 */
export function Workbench({
  topbar,
  rail,
  children,
  inspector,
  terminal,
  railCollapsed = false,
  inspectorCollapsed = false,
  inspectorOpen = true,
  layoutMode = 'auto',
  activePanel = 'conversation',
  terminalOpen = true,
  terminalLabel = 'Terminal',
  labels,
  className,
  ...props
}: WorkbenchProps) {
  return (
    <div
      {...props}
      className={cx('ah-workbench', className)}
      data-layout-mode={layoutMode}
      data-active-panel={activePanel}
      data-rail-present={Boolean(rail)}
      data-inspector-present={Boolean(inspector)}
      data-terminal-present={Boolean(terminal)}
      data-terminal-open={Boolean(terminal && terminalOpen)}
      data-rail-collapsed={railCollapsed}
      data-inspector-collapsed={inspectorCollapsed}
      data-inspector-open={inspectorOpen}
    >
      <header className="ah-workbench-topbar">{topbar}</header>
      <div className="ah-workbench-body">
        <aside
          className="ah-workbench-rail"
          aria-label={labels?.rail ?? '会话列表'}
          aria-hidden={!rail || undefined}
        >
          {rail}
        </aside>
        <main className="ah-workbench-conversation" aria-label={labels?.conversation ?? '对话'}>
          {children}
        </main>
        <aside
          className="ah-workbench-inspector"
          aria-label={labels?.inspector ?? '检查器'}
          aria-hidden={!inspector || undefined}
        >
          {inspector}
        </aside>
      </div>
      {terminal ? (
        <section
          className="ah-workbench-terminal"
          aria-label={terminalLabel}
          aria-hidden={!terminalOpen || undefined}
          data-open={terminalOpen}
          hidden={!terminalOpen}
        >
          {terminal}
        </section>
      ) : null}
    </div>
  );
}

export interface WorkbenchPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  side: WorkbenchPanelSide;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Replaces the default title row when a feature needs a richer header. */
  header?: ReactNode;
  children: ReactNode;
}

export function WorkbenchPanel({
  side,
  title,
  description,
  actions,
  header,
  children,
  className,
  ...props
}: WorkbenchPanelProps) {
  const ariaLabel = props['aria-label'] ?? (typeof title === 'string' ? title : undefined);
  return (
    <section
      {...props}
      className={cx('ah-workbench-panel', `ah-workbench-panel-${side}`, className)}
      aria-label={ariaLabel}
    >
      {header ??
        (title ? (
          <div className="ah-workbench-panel-header" role="group">
            <div className="ah-workbench-panel-header-copy">
              <h2>{title}</h2>
              {description ? <span>{description}</span> : null}
            </div>
            {actions ? <div className="ah-workbench-panel-header-actions">{actions}</div> : null}
          </div>
        ) : null)}
      <div className="ah-workbench-panel-content">{children}</div>
    </section>
  );
}

export interface WorkbenchStatusProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  tone?: WorkbenchStatusTone;
  /** Adds the subtle pulse used while an Agent is actively running. */
  busy?: boolean;
}

export function WorkbenchStatus({
  label,
  tone = 'neutral',
  busy = false,
  className,
  ...props
}: WorkbenchStatusProps) {
  return (
    <span
      {...props}
      role="status"
      aria-label={label}
      className={cx('ah-workbench-status', className)}
      data-tone={tone}
      data-busy={busy || undefined}
    >
      <span className="ah-workbench-status-dot" aria-hidden="true" />
      <span className="ah-workbench-status-label">{label}</span>
    </span>
  );
}

export interface WorkbenchDisclosureProps extends Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  'children' | 'open' | 'onToggle'
> {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Accessible progressive disclosure for thought/tool/diagnostic entries. */
export function WorkbenchDisclosure({
  summary,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  ...props
}: WorkbenchDisclosureProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const handleToggle = useCallback(
    (event: SyntheticEvent<HTMLDetailsElement>) => {
      const nextOpen = event.currentTarget.open;
      if (open === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );

  return (
    <details
      {...props}
      className={cx('ah-workbench-disclosure', className)}
      open={isOpen}
      onToggle={handleToggle}
    >
      <summary className="ah-workbench-disclosure-summary">
        <span className="ah-workbench-disclosure-chevron" aria-hidden="true" />
        <span className="ah-workbench-disclosure-summary-content">{summary}</span>
      </summary>
      <div className="ah-workbench-disclosure-content">{children}</div>
    </details>
  );
}

export interface WorkbenchExecutionItemProps extends Omit<
  WorkbenchDisclosureProps,
  'summary' | 'children' | 'title'
> {
  title: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
}

/** Compact, collapsible execution row shared by tool and plan timelines. */
export function WorkbenchExecutionItem({
  title,
  status,
  meta,
  children,
  className,
  ...props
}: WorkbenchExecutionItemProps) {
  return (
    <article className={cx('ah-workbench-execution-item', className)}>
      <WorkbenchDisclosure
        {...props}
        summary={
          <span className="ah-workbench-execution-summary">
            <span className="ah-workbench-execution-title">{title}</span>
            {meta ? <span className="ah-workbench-execution-meta">{meta}</span> : null}
            {status ? <span className="ah-workbench-execution-status">{status}</span> : null}
          </span>
        }
      >
        {children}
      </WorkbenchDisclosure>
    </article>
  );
}

export interface WorkbenchCommandBarProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  footer?: ReactNode;
  status?: ReactNode;
  label?: string;
}

/**
 * PinHarness-derived command surface. It provides the stable container and
 * footer slots; input, context and send/stop actions remain feature-owned.
 */
export function WorkbenchCommandBar({
  children,
  footer,
  status,
  label = '命令栏',
  className,
  ...props
}: WorkbenchCommandBarProps) {
  return (
    <section
      {...props}
      className={cx('ah-workbench-command-bar', className)}
      role="group"
      aria-label={label}
    >
      {status ? <div className="ah-workbench-command-status">{status}</div> : null}
      <div className="ah-workbench-command-content">{children}</div>
      {footer ? <div className="ah-workbench-command-footer">{footer}</div> : null}
    </section>
  );
}
