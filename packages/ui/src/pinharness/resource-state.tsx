/**
 * ResourceLoadingState / ResourceEmptyState — copied from PinHarness
 * components/layout/ResourceState.tsx.
 *
 * The states deliberately own only layout, motion and semantics. AgentHub
 * pages provide the domain copy and keep their existing query contracts.
 */

import { CircleNotchIcon } from '@phosphor-icons/react/CircleNotch';
import { TrayIcon } from '@phosphor-icons/react/Tray';
import type { IconProps } from '@phosphor-icons/react/lib';
import type { ComponentType, CSSProperties } from 'react';

import { cn } from './ui/cn.js';

export interface ResourceLoadingStateProps {
  text?: string;
  /** Content height in px; defaults to the available space. */
  height?: number;
  /** Use the source card surface for a full resource block. */
  bordered?: boolean;
  className?: string;
}

export function ResourceLoadingState({
  text = '加载中…',
  height,
  bordered = false,
  className,
}: ResourceLoadingStateProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        bordered &&
          'min-h-[180px] rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]',
        className,
      )}
      style={height ? ({ height } satisfies CSSProperties) : undefined}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 text-[13px] text-[hsl(var(--foreground-muted))]">
        <CircleNotchIcon
          className="h-4 w-4 animate-spin text-[hsl(var(--primary))] motion-reduce:animate-none"
          aria-hidden
        />
        {text}
      </div>
    </div>
  );
}

export interface ResourceEmptyStateProps {
  message?: string;
  icon?: ComponentType<IconProps>;
  height?: number;
  className?: string;
}

export function ResourceEmptyState({
  message = '暂无数据',
  icon: Icon = TrayIcon,
  height,
  className,
}: ResourceEmptyStateProps) {
  return (
    <div
      className={cn('flex h-[180px] flex-col items-center justify-center', className)}
      style={height ? ({ height } satisfies CSSProperties) : undefined}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--surface-muted))]">
        <Icon className="h-5 w-5 text-[hsl(var(--foreground-faint))]" aria-hidden />
      </div>
      <span className="mt-3 text-[12px] text-[hsl(var(--foreground-muted))]">{message}</span>
    </div>
  );
}
