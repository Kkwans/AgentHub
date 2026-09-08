import { cn } from './cn';
import * as React from 'react';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'input-base min-h-20 w-full resize-y px-3 py-2 text-[16px] leading-relaxed disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[hsl(var(--destructive))] aria-invalid:ring-2 aria-invalid:ring-[hsl(var(--destructive))]/15 sm:text-[length:var(--text-base)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
