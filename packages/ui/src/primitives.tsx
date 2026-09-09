import { Select, Switch, type SelectProps } from '@mantine/core';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

import {
  Button as PinButton,
  type ButtonSize as PinButtonSize,
  type ButtonVariant as PinButtonVariant,
} from './pinharness/ui/button.js';
import { cn } from './pinharness/ui/cn.js';
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
  const mappedVariant = mapLegacyButtonVariant(variant, color);
  const mappedSize = mapLegacyButtonSize(size);
  return (
    <PinButton
      {...props}
      className={cn(fullWidth && 'w-full', className)}
      size={mappedSize}
      variant={mappedVariant}
      loading={loading}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-radius={radius}
      data-legacy-color={color}
    >
      {leftSection}
      {children}
      {rightSection}
    </PinButton>
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
    <PinButton
      {...props}
      className={className}
      size={mapLegacyIconButtonSize(size)}
      variant={mapLegacyButtonVariant(variant, color)}
      aria-label={label}
      title={label}
      type={type}
      loading={loading}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
    >
      {children}
    </PinButton>
  );
}

function mapLegacyButtonVariant(variant: AhButtonVariant, color: string): PinButtonVariant {
  if (color === 'red') return 'destructive';
  if (variant === 'filled') return 'default';
  if (variant === 'light') return 'secondary';
  if (variant === 'subtle') return 'ghost';
  if (variant === 'outline' || variant === 'default') return 'outline';
  return 'default';
}

function mapLegacyButtonSize(size: AhControlSize): PinButtonSize {
  if (size === 'xs') return 'xs';
  if (size === 'sm') return 'sm';
  if (size === 'lg') return 'lg';
  return 'default';
}

function mapLegacyIconButtonSize(size: AhControlSize): PinButtonSize {
  if (size === 'xs') return 'icon-sm';
  if (size === 'sm') return 'icon-sm';
  if (size === 'lg') return 'icon';
  return 'icon';
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
