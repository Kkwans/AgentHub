import { type ReactNode, useEffect, useState } from 'react';

export function DeferredToolDetail({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  return ready ? (
    children
  ) : (
    <div className="flex h-9 items-center px-3 text-[10px] text-[hsl(var(--foreground-faint))]">
      正在准备详情…
    </div>
  );
}
