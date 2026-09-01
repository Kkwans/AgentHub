import { Eye, EyeSlash } from '@agenthub/ui';
import { forwardRef, useState, type InputHTMLAttributes } from 'react';

export type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const actionLabel = visible ? '隐藏密码' : '显示密码';

    return (
      <span className="ah-password-field">
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={['ah-password-input', className].filter(Boolean).join(' ')}
        />
        <button
          type="button"
          className="ah-password-toggle"
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
