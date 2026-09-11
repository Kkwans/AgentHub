/** PinHarness streaming indicator copied for the AgentHub chat boundary. */
import { memo } from 'react';

export const StreamingDots = memo(function StreamingDots({
  variant = 'primary',
  className,
}: {
  variant?: 'primary' | 'violet';
  className?: string;
}) {
  const dotColor = variant === 'violet' ? 'bg-violet-400' : 'bg-[hsl(var(--primary))]';
  if (variant === 'violet') {
    return (
      <span
        className={
          className ??
          'inline-flex items-center gap-[2px] animate-[hci-fade-in_300ms_ease-out_both] motion-reduce:animate-none'
        }
      >
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className={`h-1 w-1 animate-gentle-bounce rounded-full ${dotColor}`}
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className={
        className ??
        'inline-flex h-[18px] items-end gap-[3px] py-0.5 animate-[hci-fade-in_300ms_ease-out_both] motion-reduce:animate-none'
      }
    >
      {[0, 200, 400].map((delay, index) => (
        <span
          key={delay}
          className={`h-[5px] w-[5px] rounded-full ${dotColor}`}
          style={{
            animation: 'streaming-dot 1.4s ease-in-out infinite',
            animationDelay: `${delay}ms`,
            opacity: 0.7 - index * 0.2,
          }}
        />
      ))}
    </span>
  );
});
