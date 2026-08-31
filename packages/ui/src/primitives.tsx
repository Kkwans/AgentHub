import {
  ActionIcon,
  Button,
  Select,
  Switch,
  type ActionIconProps,
  type ButtonProps,
  type SelectProps,
} from '@mantine/core';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

import { AGENTHUB_CONTROL_HEIGHTS } from './theme.js';
import type { AGENTHUB_RADIUS } from './theme.js';

export type AhControlSize = keyof typeof AGENTHUB_CONTROL_HEIGHTS;
type AhRadius = keyof typeof AGENTHUB_RADIUS;

export type AhButtonProps = Omit<ButtonProps, 'size' | 'radius'> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'style' | 'size'> & {
    children: ReactNode;
    size?: AhControlSize;
    radius?: AhRadius;
  };

export function AhButton({ children, size = 'md', radius = 'control', ...props }: AhButtonProps) {
  return (
    <Button
      {...props}
      className={['ah-button', props.className].filter(Boolean).join(' ')}
      size={size}
      radius={radius === 'control' ? 'sm' : radius}
      h={AGENTHUB_CONTROL_HEIGHTS[size]}
      mih={AGENTHUB_CONTROL_HEIGHTS[size]}
    >
      {children}
    </Button>
  );
}

export function AhIconButton({
  label,
  size = 'md',
  children,
  className,
  ...props
}: Omit<ActionIconProps, 'size' | 'aria-label' | 'title'> & {
  label: string;
  size?: AhControlSize;
  children: ReactNode;
}) {
  return (
    <ActionIcon
      {...props}
      className={['ah-icon-button', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      size={AGENTHUB_CONTROL_HEIGHTS[size]}
      variant={props.variant ?? 'subtle'}
    >
      {children}
    </ActionIcon>
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
