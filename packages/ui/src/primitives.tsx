import { Select, Switch, type SelectProps } from '@mantine/core';
import { CircleNotchIcon } from '@phosphor-icons/react/CircleNotch';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

import { AGENTHUB_CONTROL_HEIGHTS } from './theme.js';
import type { AGENTHUB_RADIUS } from './theme.js';

export type AhControlSize = keyof typeof AGENTHUB_CONTROL_HEIGHTS;
type AhRadius = keyof typeof AGENTHUB_RADIUS;
export type AhButtonVariant = 'filled' | 'light' | 'subtle' | 'outline' | 'default';

export type AhButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & {
  children: ReactNode;
  size?: AhControlSize;
  radius?: AhRadius;
  color?: string;
  variant?: AhButtonVariant;
  loading?: boolean;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  /** Keep a primary action at the available inline size. */
  fullWidth?: boolean;
};

export function AhButton({
  children,
  size = 'md',
  radius = 'control',
  color = 'aurora',
  variant = 'filled',
  loading = false,
  leftSection,
  rightSection,
  fullWidth = false,
  className,
  disabled,
  ...props
}: AhButtonProps) {
  return (
    <button
      {...props}
      className={['ah-button', fullWidth && 'ah-button-full-width', className]
        .filter(Boolean)
        .join(' ')}
      data-size={size}
      data-radius={radius}
      data-color={color}
      data-variant={variant}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <CircleNotchIcon className="ah-button-loader" aria-hidden size={15} weight="bold" />
      ) : (
        leftSection
      )}
      <span className="ah-button-label">{children}</span>
      {rightSection}
    </button>
  );
}

export interface AhIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'size' | 'aria-label' | 'title'
> {
  label: string;
  size?: AhControlSize;
  children: ReactNode;
  color?: string;
  variant?: AhButtonVariant;
  loading?: boolean;
  pressed?: boolean;
}

export function AhIconButton({
  label,
  size = 'md',
  children,
  color = 'aurora',
  variant = 'subtle',
  loading = false,
  pressed,
  className,
  disabled,
  type = 'button',
  ...props
}: AhIconButtonProps) {
  return (
    <button
      {...props}
      className={['ah-icon-button', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      data-size={size}
      data-color={color}
      data-variant={variant}
      data-loading={loading || undefined}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
    >
      {loading ? (
        <CircleNotchIcon className="ah-icon-button-loader" aria-hidden size={16} weight="bold" />
      ) : (
        children
      )}
    </button>
  );
}

export function AhSelect({ label, description, size = 'md', ...props }: SelectProps) {
  return (
    <Select
      label={label}
      description={description}
      searchable
      clearable
      radius="sm"
      size={size}
      h={AGENTHUB_CONTROL_HEIGHTS[size as AhControlSize] ?? AGENTHUB_CONTROL_HEIGHTS.md}
      {...props}
    />
  );
}

export function AhSwitch({
  label,
  description,
  size = 'md',
  ...props
}: ComponentProps<typeof Switch>) {
  return <Switch label={label} description={description} color="aurora" size={size} {...props} />;
}

export interface AhChoiceOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function AhChoiceSelect({
  options,
  onValueChange,
  ...props
}: Omit<SelectProps, 'data' | 'onChange'> & {
  label: string;
  options: AhChoiceOption[];
  onValueChange?: (value: string) => void;
}) {
  return (
    <AhSelect
      {...props}
      data={options.map((option) => ({
        value: option.value,
        label: option.description ? `${option.label} · ${option.description}` : option.label,
        ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
      }))}
      onChange={(value) => {
        if (value !== null) onValueChange?.(value);
      }}
    />
  );
}
