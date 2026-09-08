import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from './cn.js';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-[var(--font-sans)] text-[length:var(--text-xs)] font-medium transition-[color,background-color,border-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30',
  {
    variants: {
      variant: {
        default:
          'border-[hsl(var(--primary))]/25 bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary-hover))]',
        secondary:
          'border-[hsl(var(--border))] bg-[hsl(var(--surface-muted))] text-[hsl(var(--foreground-muted))]',
        success:
          'border-[hsl(var(--success))]/20 bg-[hsl(var(--success-soft))] text-[hsl(var(--success-fg))]',
        destructive:
          'border-[hsl(var(--destructive))]/20 bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive-fg))]',
        warning:
          'border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning-fg))]',
        info: 'border-[hsl(var(--info))]/25 bg-[hsl(var(--info-soft))] text-[hsl(var(--info-fg))]',
        outline: 'border-[hsl(var(--border))] bg-transparent text-[hsl(var(--foreground-subtle))]',
      },
      dot: {
        true: '[&>span]:before:mr-1 [&>span]:before:inline-block [&>span]:before:size-[5px] [&>span]:before:shrink-0 [&>span]:before:rounded-full [&>span]:before:align-middle [&>span]:before:content-[""]',
      },
    },
    defaultVariants: { variant: 'default' },
    compoundVariants: [
      { variant: 'default', dot: true, className: '[&>span]:before:bg-[hsl(var(--primary))]' },
      { variant: 'success', dot: true, className: '[&>span]:before:bg-[hsl(var(--success))]' },
      {
        variant: 'destructive',
        dot: true,
        className: '[&>span]:before:bg-[hsl(var(--destructive))]',
      },
      { variant: 'warning', dot: true, className: '[&>span]:before:bg-[hsl(var(--warning))]' },
      { variant: 'info', dot: true, className: '[&>span]:before:bg-[hsl(var(--info))]' },
      {
        variant: 'secondary',
        dot: true,
        className: '[&>span]:before:bg-[hsl(var(--foreground-muted))]',
      },
    ],
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <div className={cn('ui-badge', badgeVariants({ variant, dot }), className)} {...props}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">{children}</span>
    </div>
  );
}

export { Badge, badgeVariants };
