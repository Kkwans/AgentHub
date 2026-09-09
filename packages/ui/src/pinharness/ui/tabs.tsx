import * as RadixTabs from '@radix-ui/react-tabs';
import type * as React from 'react';

import { cn } from './cn.js';

/**
 * PinHarness Tabs 基座（Radix UI）。
 *
 * 组件只负责可访问的 tab 语义和焦点管理；内容/路由状态仍由 AgentHub
 * feature 持有，避免把领域导航耦合进共享包。
 */
export const Tabs = RadixTabs.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn(
        'flex items-center gap-4 overflow-x-auto border-b border-[hsl(var(--border))]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'relative min-h-10 shrink-0 cursor-pointer select-none px-1 py-2.5 text-[length:var(--text-sm)] font-medium text-[hsl(var(--foreground-muted))] outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:text-[hsl(var(--foreground))] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--primary))]/25 data-[state=active]:font-semibold data-[state=active]:text-[hsl(var(--primary))] data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-[hsl(var(--primary))]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content
      className={cn('flex-1 outline-none animate-[hci-fade-in_var(--motion-fast)_ease]', className)}
      {...props}
    />
  );
}
