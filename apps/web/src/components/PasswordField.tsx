import { Eye, EyeSlash, IconButton, TextField } from '@agenthub/ui';
import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react';

export type PasswordFieldProps = Omit<ComponentPropsWithoutRef<typeof TextField.Root>, 'type'>;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ className, children, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const actionLabel = visible ? '隐藏密码' : '显示密码';

    return (
      <TextField.Root
        {...props}
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={['ah-password-field', className].filter(Boolean).join(' ')}
      >
        {children}
        <TextField.Slot side="right" pr="1">
          <IconButton
            type="button"
            size="1"
            color="gray"
            variant="ghost"
            className="ah-password-toggle"
            aria-label={actionLabel}
            aria-pressed={visible}
            title={actionLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeSlash aria-hidden size={17} /> : <Eye aria-hidden size={17} />}
          </IconButton>
        </TextField.Slot>
      </TextField.Root>
    );
  },
);
