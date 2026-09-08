import { cn } from './cn';
import type React from 'react';

interface SkeletonProps {
  className?: string;
}

/** 基础 skeleton 条——animate-pulse 的圆角矩形 */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-[hsl(var(--border))]/50', className)} />;
}

/** 多行文本 skeleton */
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

/** 卡片 skeleton（标题 + 正文行） */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-lg border border-[hsl(var(--border))]/40 p-3 space-y-3', className)}
    >
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={2} />
    </div>
  );
}

/** 三栏布局 skeleton（用于 RunDetailPage） */
export function SkeletonThreeColumn({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-full gap-px', className)}>
      {/* 左栏 */}
      <div className="w-52 shrink-0 space-y-3 border-r border-[hsl(var(--border))]/30 p-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
      {/* 中栏 */}
      <div className="flex-1 space-y-4 p-4">
        <Skeleton className="h-6 w-1/2" />
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-12 w-5/6 rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      </div>
      {/* 右栏 */}
      <div className="w-64 shrink-0 space-y-3 border-l border-[hsl(var(--border))]/30 p-3">
        <Skeleton className="h-5 w-1/2" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
