import type React from 'react';

import { cn } from './cn.js';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-[hsl(var(--border))]/50', className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      <SkeletonLines count={lines} />
    </div>
  );
}

function SkeletonLines({ count }: { count: number }) {
  const items: React.ReactElement[] = [];
  for (let n = 0; n < count; n++) {
    const isLast = n === count - 1;
    const width = isLast ? 'w-2/3' : n % 2 === 0 ? 'w-full' : 'w-5/6';
    items.push(<Skeleton key={`line${n}`} className={cn('h-3', width)} />);
  }
  return <>{items}</>;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('space-y-3 rounded-lg border border-[hsl(var(--border))]/40 p-3', className)}
    >
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={2} />
    </div>
  );
}

export function SkeletonThreeColumn({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-full gap-px', className)}>
      <div className="w-52 shrink-0 space-y-3 border-r border-[hsl(var(--border))]/30 p-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="flex-1 space-y-4 p-4">
        <Skeleton className="h-6 w-1/2" />
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-12 w-5/6 rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      </div>
      <div className="w-64 shrink-0 space-y-3 border-l border-[hsl(var(--border))]/30 p-3">
        <Skeleton className="h-5 w-1/2" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
