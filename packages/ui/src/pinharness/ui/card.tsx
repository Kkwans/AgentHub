import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from './cn.js';

const cardVariants = cva(
  'min-w-0 rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,background-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
  {
    variants: {
      variant: {
        default: '',
        interactive:
          'cursor-pointer hover:border-[hsl(var(--primary))]/28 hover:bg-[hsl(var(--surface-muted))]/32 active:bg-[hsl(var(--surface-muted))]/58 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[hsl(var(--primary))]/18 focus-visible:ring-offset-1',
        selected:
          'border-[hsl(var(--primary))] bg-[hsl(var(--primary-soft))] shadow-[var(--shadow-sm)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex min-w-0 flex-col space-y-1 p-4 pb-3 sm:p-5 sm:pb-4', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        'text-[length:var(--text-base)] font-semibold leading-tight tracking-tight text-[hsl(var(--foreground))]',
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      'text-[length:var(--text-sm)] leading-relaxed text-[hsl(var(--foreground-subtle))]',
      className,
    )}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('min-w-0 p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-2 rounded-b-[var(--radius-xl)] border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-muted))] p-3 sm:p-4',
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
