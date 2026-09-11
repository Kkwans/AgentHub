/**
 * useRunningTimer — 运行中计时器 hook
 *
 * 当 active=true 时，每秒 tick 一次，返回递增的 tick 值（用于触发重渲染）。
 * active=false 时不启动 interval，tick 为 0。
 *
 * 被 TotalDurationChip（RunDetailPage）和 NodeDuration（DagNode）复用。
 *
 * 用法：
 *   const tick = useRunningTimer(isRunning);
 *   // tick 变化时组件重渲染，可在渲染函数中读取 Date.now() 获取最新时间
 */

import { useEffect, useState } from 'react';

export function useRunningTimer(active: boolean, intervalMs = 1000): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return tick;
}
