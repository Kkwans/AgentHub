/**
 * PageHeader / NavigationPageHeader — copied from PinHarness
 * components/layout/PageHeader.tsx.
 *
 * Keep the source geometry in the shared package so pages cannot drift into
 * another title/header implementation.
 */

import type { ComponentType, ReactNode } from 'react';

import type { IconProps } from '@phosphor-icons/react/lib';

import { cn } from './ui/cn.js';

export interface PageHeaderProps {
  icon: ComponentType<IconProps>;
  title: ReactNode;
  description: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  bordered?: boolean;
  className?: string;
}

export interface NavigationPageHeaderProps extends Omit<PageHeaderProps, 'bordered'> {
  containerClassName?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  badge,
  actions,
  leading,
  bordered = true,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'page-heading page-header-row flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        bordered && 'border-b border-[hsl(var(--border))] pb-5',
        className,
      )}
    >
      <div className="page-title-group flex min-w-0 items-start gap-3.5">
        {leading}
        <div className="page-heading-icon h-10 w-10">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title">{title}</h1>
            {badge}
          </div>
          <p className="page-subtitle">{description}</p>
        </div>
      </div>
      {actions ? (
        <div className="page-header-actions w-full shrink-0 sm:w-auto">{actions}</div>
      ) : null}
    </header>
  );
}

export function NavigationPageHeader({
  containerClassName,
  className,
  ...props
}: NavigationPageHeaderProps) {
  return (
    <div
      className={cn(
        'navigation-page-header projects-dashboard-header workspace-header shrink-0 px-4 sm:px-6 lg:px-8',
        containerClassName,
      )}
    >
      <PageHeader {...props} bordered={false} className={cn('content-grid py-5', className)} />
    </div>
  );
}
