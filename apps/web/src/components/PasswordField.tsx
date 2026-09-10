import { Eye, EyeSlash, Input } from '@agenthub/ui';
import { forwardRef, useState, type InputHTMLAttributes } from 'react';

export type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const actionLabel = visible ? '隐藏密码' : '显示密码';

    return (
      <span className="relative block w-full">
        <Input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={['pr-11', className].filter(Boolean).join(' ')}
        />
        <button
          type="button"
          className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[hsl(var(--foreground-faint))] transition-[background-color,color] duration-[var(--motion-fast)] hover:bg-[hsl(var(--surface-muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/30"
          aria-label={actionLabel}
          aria-pressed={visible}
          title={actionLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeSlash aria-hidden size={17} /> : <Eye aria-hidden size={17} />}
        </button>
      </span>
    );
  },
);
