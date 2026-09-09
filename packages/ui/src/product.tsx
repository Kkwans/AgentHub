import { motion, useReducedMotion } from 'motion/react';
import { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/Info';
import { WarningCircleIcon } from '@phosphor-icons/react/WarningCircle';
import { CircleNotchIcon } from '@phosphor-icons/react/CircleNotch';
import { XIcon } from '@phosphor-icons/react/X';
import {
  forwardRef,
  useId,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
  type TouchEvent,
} from 'react';

import { Button as PinButton } from './pinharness/ui/button.js';
import { Badge as PinBadge, type BadgeProps as PinBadgeProps } from './pinharness/ui/badge.js';
import { Card as PinCard, type CardProps as PinCardProps } from './pinharness/ui/card.js';
import { cn } from './pinharness/ui/cn.js';
import { Input as PinInput } from './pinharness/ui/input.js';
import { Select as PinSelect } from './pinharness/ui/select.js';
import { Skeleton as PinSkeleton } from './pinharness/ui/skeleton.js';
import { Textarea as PinTextarea } from './pinharness/ui/textarea.js';
import { FormDialog } from './components/index.js';
import { useAgentHubTheme } from './provider.js';

const statusLabels: Record<string, string> = {
  READY: '就绪',
  RUNNING: '执行中',
  COMPLETED: '已完成',
  DONE: '已完成',
  ACTIVE: '使用中',
  IN_PROGRESS: '进行中',
  WAITING_REVIEW: '待审阅',
  AWAITING_INPUT: '等待输入',
  REVIEW: '待审阅',
  BLOCKED: '已阻塞',
  FAILED: '失败',
  BROKEN: '异常',
  STOPPED: '已停止',
  OFFLINE: '离线',
  ONLINE: '在线',
  REVOKED: '已撤销',
  PENDING: '等待处理',
  CANCELED: '已取消',
  DISCONNECTED: '已断开',
  UNAVAILABLE: '不可用',
  AUTH_REQUIRED: '需要授权',
  CLOSED: '已关闭',
  MISSING_DEPENDENCY: '缺少依赖',
  UNSUPPORTED: '不支持',
  UNKNOWN: '未知',
};

function statusColor(status: string): string {
  if (['READY', 'COMPLETED', 'DONE', 'ACTIVE', 'ONLINE'].includes(status)) return 'green';
  if (['RUNNING', 'IN_PROGRESS', 'REVIEW', 'WAITING_REVIEW', 'PENDING'].includes(status))
    return 'aurora';
  if (['BLOCKED', 'FAILED', 'BROKEN', 'REVOKED', 'AUTH_REQUIRED'].includes(status)) return 'red';
  if (['STOPPED', 'OFFLINE', 'DISCONNECTED', 'CANCELED', 'CLOSED'].includes(status)) return 'gray';
  return 'yellow';
}

export function humanizeStatus(status: string): string {
  return statusLabels[status] ?? '状态';
}

export function AhStatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span role="status">
      <BadgeLike color={statusColor(status)}>{label ?? humanizeStatus(status)}</BadgeLike>
    </span>
  );
}

function BadgeLike({ color, children }: { color: string; children: ReactNode }) {
  return (
    <PinBadge {...toneToBadgeProps(color)} data-tone={color}>
      {children}
    </PinBadge>
  );
}

function toneToBadgeProps(color: string): Pick<PinBadgeProps, 'variant'> {
  if (color === 'green') return { variant: 'success' };
  if (color === 'red') return { variant: 'destructive' };
  if (color === 'yellow') return { variant: 'warning' };
  if (color === 'aurora') return { variant: 'default' };
  return { variant: 'secondary' };
}

export function AhStatusDot({ status, label }: { status: string; label?: string }) {
  const tone = statusColor(status);
  return (
    <span className="ah-status-dot" data-tone={tone} role="status">
      <span aria-hidden="true" />
      {label ?? humanizeStatus(status)}
    </span>
  );
}

export function AhEmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center px-4 text-center',
        compact ? 'gap-1.5 py-6' : 'gap-3 py-12',
      )}
    >
      <span
        className={cn(
          'grid place-items-center rounded-full border border-[hsl(var(--primary))]/20 bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]',
          compact ? 'size-9' : 'size-11',
        )}
        aria-hidden="true"
      >
        {icon ?? <InfoIcon size={compact ? 17 : 20} />}
      </span>
      <h3
        className={cn(
          'm-0 text-[length:var(--text-base)] font-semibold leading-tight',
          compact && 'text-sm',
        )}
      >
        {title}
      </h3>
      {description ? (
        <p className="m-0 max-w-[480px] text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1 flex items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function AhErrorState({
  title = '加载失败',
  description,
  retry,
  retryLabel = '重试',
}: {
  title?: string;
  description?: string;
  retry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex max-w-[720px] items-start gap-3 rounded-[var(--radius-lg)] border border-[hsl(var(--destructive))]/20 bg-[hsl(var(--destructive-soft))] p-3 text-[hsl(var(--destructive-fg))]"
    >
      <WarningCircleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold leading-5">{title}</strong>
        <p className="m-0 mt-1 text-sm leading-5 text-[hsl(var(--foreground-muted))]">
          {description ?? '请检查连接后重试。'}
        </p>
      </div>
      {retry ? (
        <PinButton size="xs" variant="destructive" onClick={retry}>
          {retryLabel}
        </PinButton>
      ) : null}
    </div>
  );
}

export function AhLoadingState({
  label = '正在加载',
  description,
  rows = 3,
}: {
  label?: string;
  description?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <div className="flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))]">
        <CircleNotchIcon className="size-4 animate-spin text-[hsl(var(--primary))]" aria-hidden />
        <span>{label}</span>
      </div>
      {description ? (
        <p className="m-0 text-xs leading-5 text-[hsl(var(--foreground-muted))]">{description}</p>
      ) : null}
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <PinSkeleton key={index} className={index === 0 ? 'h-11 w-full' : 'h-8 w-full'} />
        ))}
      </div>
    </div>
  );
}

export function AhProjectContext({
  project,
  tabs,
}: {
  project: { id: string; name: string; rootPath: string; status?: string };
  tabs: Array<{ to: string; label: string; count?: number }>;
}) {
  return (
    <section className="ah-project-context">
      <div className="ah-project-context-bar">
        <div className="ah-project-context-copy">
          <span className="ah-project-context-eyebrow">当前项目</span>
          <h2>{project.name}</h2>
          <code title={project.rootPath}>{project.rootPath}</code>
        </div>
        {project.status ? <AhStatusPill status={project.status} /> : null}
      </div>
      <nav aria-label="项目上下文" className="ah-project-context-tabs">
        {tabs.map((tab) => (
          <a key={tab.to} href={tab.to}>
            <span>{tab.label}</span>
            {typeof tab.count === 'number' ? <small>{tab.count}</small> : null}
          </a>
        ))}
      </nav>
    </section>
  );
}

export function AhMetric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning';
}) {
  const colors = {
    neutral: 'var(--ah-text-primary)',
    accent: 'var(--ah-accent-primary)',
    success: 'var(--ah-success)',
    warning: 'var(--ah-warning)',
  };
  return (
    <div className="ah-metric" data-tone={tone}>
      <span className="ah-metric-label">{label}</span>
      <strong className="ah-metric-value" style={{ color: colors[tone] }}>
        {value}
      </strong>
      {hint ? <span className="ah-metric-hint">{hint}</span> : null}
    </div>
  );
}

export type AhSurfaceProps = PinCardProps & { children: ReactNode; withBorder?: boolean };

export function AhSurface({ children, withBorder = true, className, ...props }: AhSurfaceProps) {
  return (
    <PinCard {...props} className={cn(!withBorder && 'border-transparent', className)}>
      {children}
    </PinCard>
  );
}

export function AhThemeSelect() {
  const { preference, setPreference } = useAgentHubTheme();
  return (
    <label className="ah-field">
      <span className="ah-field-label">主题</span>
      <PinSelect
        ariaLabel="主题"
        value={preference}
        onValueChange={(value) => {
          if (value === 'light' || value === 'dark' || value === 'system') setPreference(value);
        }}
        options={[
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
          { value: 'system', label: '跟随系统' },
        ]}
      />
    </label>
  );
}

export type AhInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
};

export const AhInput = forwardRef<HTMLInputElement, AhInputProps>(
  (
    { label, description, error, leftSection, rightSection, id, className, required, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const controlId = id ?? `agenthub-input-${generatedId}`;
    const control = (
      <div className="ah-control-with-adornment">
        {leftSection ? (
          <span className="ah-input-adornment ah-input-adornment-left" aria-hidden="true">
            {leftSection}
          </span>
        ) : null}
        <PinInput
          {...props}
          ref={ref}
          id={controlId}
          required={required}
          aria-invalid={error ? true : props['aria-invalid']}
          className={cn(leftSection && 'pl-9', rightSection && 'pr-9', className)}
        />
        {rightSection ? (
          <span className="ah-input-adornment ah-input-adornment-right" aria-hidden="true">
            {rightSection}
          </span>
        ) : null}
      </div>
    );
    if (!label && !description && !error) return control;
    return (
      <div className="ah-field" data-invalid={error ? 'true' : undefined}>
        {label ? (
          <label className="ah-field-label" htmlFor={controlId}>
            {label}
            {required ? (
              <span className="ah-required" aria-hidden="true">
                {' '}
                *
              </span>
            ) : null}
          </label>
        ) : null}
        {control}
        {description ? <p className="ah-field-description">{description}</p> : null}
        {error ? (
          <p className="ah-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
AhInput.displayName = 'AhInput';

export type AhTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  description?: ReactNode;
  minRows?: number;
  autosize?: boolean;
};

export const AhTextarea = forwardRef<HTMLTextAreaElement, AhTextareaProps>(
  (
    { label, description, minRows = 4, autosize: _autosize, className, required, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const controlId = props.id ?? `agenthub-textarea-${generatedId}`;
    const control = (
      <PinTextarea
        {...props}
        ref={ref}
        id={controlId}
        rows={minRows}
        required={required}
        aria-label={typeof label === 'string' ? label : props['aria-label']}
        className={cn('ah-field-textarea', className)}
      />
    );
    return (
      <div className="ah-field">
        {label ? (
          <label className="ah-field-label" htmlFor={controlId}>
            {label}
            {required ? (
              <span className="ah-required" aria-hidden="true">
                {' '}
                *
              </span>
            ) : null}
          </label>
        ) : null}
        {control}
        {description ? <p className="ah-field-description">{description}</p> : null}
      </div>
    );
  },
);
AhTextarea.displayName = 'AhTextarea';

export function AhDialog({
  open,
  title,
  description,
  onClose,
  children,
  actions,
  size = 560,
  fullScreen = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  size?: number | string;
  fullScreen?: boolean;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      title={title}
      size={resolveFormDialogSize(size)}
      fullScreen={fullScreen}
      {...(description ? { description } : {})}
      {...(actions ? { footer: actions } : {})}
    >
      {children}
    </FormDialog>
  );
}

function resolveFormDialogSize(size: number | string | undefined): 'small' | 'medium' | 'large' {
  if (typeof size === 'number') {
    if (size <= 480) return 'small';
    if (size >= 760) return 'large';
    return 'medium';
  }
  if (size === 'small' || size === 'medium' || size === 'large') return size;
  if (size === 'xs' || size === 'sm') return 'small';
  if (size === 'lg' || size === 'xl') return 'large';
  return 'medium';
}

export function AhDrawer({
  open,
  title,
  onClose,
  children,
  position = 'left',
  size,
  showHeader = true,
  bodyClassName,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  position?: 'left' | 'right' | 'top' | 'bottom';
  size?: number | string;
  /** Hide the generic title row when the drawer content owns its mobile identity. */
  showHeader?: boolean;
  /** Optional class for source-layout content such as a flush mobile navigation. */
  bodyClassName?: string;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const touchStartXRef = useRef<number | null>(null);
  const historyMarkerRef = useRef<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const clearHistoryMarker = () => {
    const marker = historyMarkerRef.current;
    if (!marker || window.history.state?.agentHubDrawer !== marker) return;
    const nextState = { ...(window.history.state ?? {}) } as Record<string, unknown>;
    delete nextState.agentHubDrawer;
    window.history.replaceState(nextState, '');
    historyMarkerRef.current = null;
  };

  const requestClose = () => {
    clearHistoryMarker();
    onCloseRef.current();
  };

  useEffect(() => {
    if (!open) return undefined;
    const drawer = drawerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousWidth = document.body.style.width;
    const previousTop = document.body.style.top;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    if (position === 'left') {
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    }

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusInitial = () => {
      const initial = drawer?.querySelector<HTMLElement>(focusableSelector) ?? drawer;
      initial?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const frame = requestAnimationFrame(focusInitial);
    const historyMarker = `ah-drawer-${Date.now()}`;
    historyMarkerRef.current = historyMarker;
    window.history.pushState(
      { ...(window.history.state ?? {}), agentHubDrawer: historyMarker },
      '',
    );
    const handlePopState = () => onCloseRef.current();
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('popstate', handlePopState);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('popstate', handlePopState);
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.width = previousWidth;
      document.body.style.top = previousTop;
      if (position === 'left') window.scrollTo(0, scrollY);
      clearHistoryMarker();
      previouslyFocused?.focus();
      setDragOffset(0);
    };
  }, [open, position]);

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (position !== 'left' && position !== 'right') return;
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    if (position !== 'left' && position !== 'right') return;
    const startX = touchStartXRef.current;
    const currentX = event.touches[0]?.clientX;
    if (startX == null || currentX == null) return;
    const delta = position === 'left' ? startX - currentX : currentX - startX;
    setDragOffset(Math.max(0, delta));
  };
  const onTouchEnd = () => {
    if (dragOffset > 72) requestClose();
    else setDragOffset(0);
    touchStartXRef.current = null;
  };
  const onTouchCancel = () => {
    touchStartXRef.current = null;
    setDragOffset(0);
  };

  if (!open) return null;
  const drawerSize = resolveDrawerSize(size, position);
  return (
    <div
      className="ah-drawer-backdrop"
      data-position={position}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`ah-drawer ah-drawer-${position}`}
        style={{
          ...drawerSize,
          ...(dragOffset > 0
            ? {
                transform:
                  position === 'right'
                    ? `translateX(${dragOffset}px)`
                    : `translateX(-${dragOffset}px)`,
                transition: 'none',
              }
            : {}),
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {showHeader ? (
          <header className="ah-drawer-header">
            <h2>{title}</h2>
            <PinButton
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="关闭"
              onClick={requestClose}
            >
              <XIcon size={16} aria-hidden />
            </PinButton>
          </header>
        ) : null}
        <div className={`ah-drawer-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
          {children}
        </div>
      </aside>
    </div>
  );
}

function resolveDrawerSize(size: number | string | undefined, position: string) {
  const horizontal = position === 'left' || position === 'right';
  if (typeof size === 'number')
    return horizontal ? { width: `${size}px` } : { height: `${size}px` };
  if (size) return horizontal ? { width: size } : { height: size };
  return horizontal ? { width: 'min(88vw, 380px)' } : { height: 'min(76vh, 560px)' };
}

export function AhReveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      {...(reduced ? {} : { initial: { opacity: 0, y: 8 } })}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: delay / 1000, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function AhToastNotice({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="ah-toast-notice" role="status">
      <CheckCircleIcon size={18} aria-hidden />
      <div className="ah-toast-notice-copy">{children}</div>
      {onClose ? (
        <PinButton
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="关闭提示"
          onClick={onClose}
        >
          <XIcon size={15} aria-hidden />
        </PinButton>
      ) : null}
    </div>
  );
}
