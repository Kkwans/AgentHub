import * as React from 'react';

import { cn } from './cn.js';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'input-base min-h-11 w-full px-3 py-2 text-[16px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[hsl(var(--destructive))] aria-invalid:ring-2 aria-invalid:ring-[hsl(var(--destructive))]/15 sm:min-h-9 sm:text-[length:var(--text-base)]',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
