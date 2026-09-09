import { Switch } from '@mantine/core';
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from 'react';

import {
  Button as PinButton,
  type ButtonSize as PinButtonSize,
  type ButtonVariant as PinButtonVariant,
} from './pinharness/ui/button.js';
import { cn } from './pinharness/ui/cn.js';
import { Select as PinSelect, type PinSelectOption } from './pinharness/ui/select.js';
import type { AGENTHUB_CONTROL_HEIGHTS, AGENTHUB_RADIUS } from './theme.js';

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

export interface AhSelectDataItem {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
}

export interface AhSelectProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  size?: AhControlSize;
  value?: string | null;
  defaultValue?: string;
  onChange?: (value: string | null) => void;
  onValueChange?: (value: string) => void;
  data?: ReadonlyArray<AhSelectDataItem> | ReadonlyArray<string>;
  options?: ReadonlyArray<PinSelectOption>;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  mt?: string | number;
  /** 保留旧页面调用契约；PinHarness Select 本身使用键盘与分组选择。 */
  searchable?: boolean;
  clearable?: boolean;
  allowDeselect?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

const MANTINE_SPACING: Record<string, number> = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
};

function resolveSelectMarginTop(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return value;
  return value ? (MANTINE_SPACING[value] ?? undefined) : undefined;
}

function normalizeSelectOptions(
  data: AhSelectProps['data'],
  options: AhSelectProps['options'],
): PinSelectOption[] {
  if (options) return [...options];
  return (data ?? []).map((item) =>
    typeof item === 'string' ? { value: item, label: item } : { ...item },
  );
}

export function AhSelect({
  label,
  description,
  error,
  size: _size = 'md',
  value,
  defaultValue,
  onChange,
  onValueChange,
  data,
  options,
  placeholder,
  disabled,
  required,
  id,
  className,
  mt,
  searchable = true,
  clearable = true,
  allowDeselect: _allowDeselect,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: AhSelectProps) {
  const generatedId = useId();
  const controlId = id ?? `agenthub-select-${generatedId.replaceAll(':', '')}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [ariaDescribedBy, descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const normalizedOptions = normalizeSelectOptions(data, options);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const selectValue = isControlled ? (value ?? undefined) : uncontrolledValue;
  const resolvedAriaLabel = ariaLabel ?? (typeof label === 'string' && label ? label : undefined);
  const control = (
    <PinSelect
      id={controlId}
      {...(selectValue === undefined ? {} : { value: selectValue })}
      onValueChange={(nextValue) => {
        if (!isControlled) setUncontrolledValue(nextValue);
        onChange?.(nextValue === '' ? null : nextValue);
        onValueChange?.(nextValue);
      }}
      options={normalizedOptions}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(disabled === undefined ? {} : { disabled })}
      className={cn('ah-select-trigger', className)}
      searchable={searchable}
      clearable={clearable}
      {...(resolvedAriaLabel === undefined ? {} : { ariaLabel: resolvedAriaLabel })}
      {...(describedBy === undefined ? {} : { ariaDescribedBy: describedBy })}
      ariaInvalid={ariaInvalid ?? Boolean(error)}
      {...((ariaRequired ?? required) === undefined
        ? {}
        : { 'aria-required': ariaRequired ?? required })}
    />
  );

  if (!label && !description && !error && mt === undefined) return control;
  return (
    <div
      className="ah-field"
      data-invalid={error ? 'true' : undefined}
      style={{
        ...(resolveSelectMarginTop(mt) === undefined
          ? {}
          : { marginTop: resolveSelectMarginTop(mt) }),
      }}
    >
      {label ? (
        <label className="ah-field-label" htmlFor={controlId}>
          {label}
          {required ? (
            <span className="ah-required" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {control}
      {description ? (
        <p id={descriptionId} className="ah-field-description">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ah-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
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
}: Omit<AhSelectProps, 'data' | 'onChange' | 'options' | 'onValueChange'> & {
  label: string;
  options: AhChoiceOption[];
  onValueChange?: (value: string) => void;
}) {
  return (
    <AhSelect
      {...props}
      options={options}
      {...(onValueChange === undefined ? {} : { onValueChange })}
    />
  );
}
