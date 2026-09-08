import { CircleNotchIcon } from '@phosphor-icons/react/CircleNotch';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from './cn.js';

const buttonVariants = cva(
  'mobile-touch-target inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] text-sm font-semibold transition-[background-color,color,border-color,opacity,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[hsl(var(--primary))]/18 focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 data-[loading=true]:cursor-wait [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-[hsl(var(--primary-hover))]/35 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-sm)] hover:bg-[hsl(var(--primary-hover))] active:shadow-none',
        destructive:
          'border border-[hsl(var(--destructive))]/20 bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive-fg))] hover:border-[hsl(var(--destructive))]/35 hover:bg-[hsl(var(--destructive))]/12',
        outline:
          'border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground-muted))] shadow-[var(--shadow-sm)] hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-muted))]/65 hover:text-[hsl(var(--foreground))] active:shadow-none',
        secondary:
          'bg-[hsl(var(--surface-muted))] text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))]',
        ghost:
          'text-[hsl(var(--foreground-subtle))] hover:bg-[hsl(var(--surface-muted))] hover:text-[hsl(var(--foreground))]',
        link: 'text-[hsl(var(--primary))] underline-offset-4 hover:text-[hsl(var(--primary-hover))] hover:underline',
      },
      size: {
        default: 'h-[34px] px-4 py-1.5 text-[13px]',
        sm: 'h-[30px] rounded-[var(--radius)] px-3.5 text-[12px]',
        lg: 'h-[40px] rounded-[var(--radius-lg)] px-6 text-[14px]',
        xs: 'h-[26px] rounded-[var(--radius-sm)] px-2.5 text-[12px]',
        icon: 'h-[34px] w-[34px]',
        'icon-sm': 'h-[30px] w-[30px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? 'span' : 'button';
    const isDisabled = disabled || loading;
    const compoundedProps = asChild
      ? { 'aria-disabled': isDisabled, 'data-loading': loading }
      : { disabled: isDisabled };

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...compoundedProps}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <CircleNotchIcon className="size-3.5 animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
