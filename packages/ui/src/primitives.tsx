import { Select, Switch, type SelectProps } from '@mantine/core';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

import { AGENTHUB_CONTROL_HEIGHTS } from './theme.js';
import type { AGENTHUB_RADIUS } from './theme.js';

export type AhControlSize = keyof typeof AGENTHUB_CONTROL_HEIGHTS;
type AhRadius = keyof typeof AGENTHUB_RADIUS;

export type AhButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & {
  children: ReactNode;
  size?: AhControlSize;
  radius?: AhRadius;
  color?: string;
  variant?: 'filled' | 'light' | 'subtle' | 'outline' | 'default';
  loading?: boolean;
  leftSection?: ReactNode;
};

export function AhButton({
  children,
  size = 'md',
  radius = 'control',
  color = 'aurora',
  variant = 'filled',
  loading = false,
  leftSection,
  className,
  disabled,
  ...props
}: AhButtonProps) {
  return (
    <button
      {...props}
      className={['ah-button', className].filter(Boolean).join(' ')}
      data-size={size}
      data-radius={radius}
      data-color={color}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {leftSection}
      {children}
    </button>
  );
}

export function AhIconButton({
  label,
  size = 'md',
  children,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size' | 'aria-label' | 'title'> & {
  label: string;
  size?: AhControlSize;
  children: ReactNode;
  color?: string;
  variant?: 'filled' | 'light' | 'subtle' | 'outline' | 'default';
}) {
  return (
    <button
      {...props}
      className={['ah-icon-button', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      data-size={size}
      data-color={props.color ?? 'aurora'}
      data-variant={props.variant ?? 'subtle'}
      type={props.type ?? 'button'}
    >
      {children}
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
