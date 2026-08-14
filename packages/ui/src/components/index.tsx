import * as React from 'react';
import {
  AlertDialog as RadixAlertDialog,
  Button as RadixButton,
  Dialog as RadixDialog,
  Flex,
  Heading,
  IconButton as RadixIconButton,
  Text,
  TextArea as RadixTextArea,
  TextField as RadixTextField,
} from '@radix-ui/themes';
import { CheckIcon } from '@phosphor-icons/react/Check';
import { CaretDownIcon } from '@phosphor-icons/react/CaretDown';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/MagnifyingGlass';
import { XIcon } from '@phosphor-icons/react/X';

export type FormDialogSize = 'small' | 'medium' | 'large';

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: FormDialogSize;
  labelledBy?: string;
  describedBy?: string;
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'medium',
  labelledBy,
  describedBy,
}: FormDialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Content className={`ah-dialog ah-dialog-${size}`}>
        <Flex align="start" justify="between" gap="4" className="ah-dialog-header">
          <div>
            <RadixDialog.Title {...(labelledBy ? { id: labelledBy } : {})} size="5">
              {title}
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description
                {...(describedBy ? { id: describedBy } : {})}
                color="gray"
                size="2"
              >
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close type="button" className="ah-dialog-close" aria-label="关闭">
            <XIcon aria-hidden size={18} />
          </RadixDialog.Close>
        </Flex>
        <div className="ah-dialog-body">{children}</div>
        {footer ? <div className="ah-dialog-footer">{footer}</div> : null}
      </RadixDialog.Content>
    </RadixDialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Content className="ah-dialog ah-dialog-small">
        <RadixAlertDialog.Title size="5">{title}</RadixAlertDialog.Title>
        <RadixAlertDialog.Description size="2" color="gray">
          {description}
        </RadixAlertDialog.Description>
        <Flex justify="end" gap="2" className="ah-dialog-footer">
          <RadixAlertDialog.Cancel type="button" className="ah-dialog-secondary" disabled={pending}>
            {cancelLabel}
          </RadixAlertDialog.Cancel>
          <RadixAlertDialog.Action
            type="button"
            className={destructive ? 'ah-dialog-danger' : 'ah-dialog-primary'}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? '处理中…' : confirmLabel}
          </RadixAlertDialog.Action>
        </Flex>
      </RadixAlertDialog.Content>
    </RadixAlertDialog.Root>
  );
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  description,
  error,
  required = false,
  children,
}: FieldProps) {
  const descriptionId = htmlFor ? `${htmlFor}-description` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const describedBy =
    [description ? descriptionId : undefined, error ? errorId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="ah-field" data-invalid={Boolean(error) || undefined}>
      <div className="ah-field-label-row">
        <label className="ah-field-label" htmlFor={htmlFor}>
          {label}
        </label>
        {required ? (
          <span className="ah-required" aria-hidden="true">
            必填
          </span>
        ) : null}
      </div>
      <div aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined}>
        {children}
      </div>
      {description ? (
        <Text id={descriptionId} as="p" className="ah-field-description" color="gray" size="1">
          {description}
        </Text>
      ) : null}
      {error ? (
        <Text id={errorId} as="p" className="ah-field-error" color="red" size="1" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

export type FormTextFieldProps = Omit<
  React.ComponentPropsWithoutRef<typeof RadixTextField.Root>,
  'size'
> &
  Pick<FieldProps, 'label' | 'description' | 'error' | 'required'>;

export function FormTextField({
  label,
  description,
  error,
  required,
  id,
  ...props
}: FormTextFieldProps) {
  return (
    <Field
      label={label}
      {...(id ? { htmlFor: id } : {})}
      {...(description ? { description } : {})}
      {...(error ? { error } : {})}
      {...(required ? { required } : {})}
    >
      <RadixTextField.Root
        {...(id ? { id } : {})}
        size="2"
        {...props}
        aria-invalid={Boolean(error) || undefined}
      />
    </Field>
  );
}

export type FormTextAreaProps = Omit<React.ComponentPropsWithoutRef<typeof RadixTextArea>, 'size'> &
  Pick<FieldProps, 'label' | 'description' | 'error' | 'required'>;

export function FormTextArea({
  label,
  description,
  error,
  required,
  id,
  ...props
}: FormTextAreaProps) {
  return (
    <Field
      label={label}
      {...(id ? { htmlFor: id } : {})}
      {...(description ? { description } : {})}
      {...(error ? { error } : {})}
      {...(required ? { required } : {})}
    >
      <RadixTextArea
        {...(id ? { id } : {})}
        size="2"
        {...props}
        aria-invalid={Boolean(error) || undefined}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  label: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  options: SelectOption[];
  onValueChange?: (value: string) => void;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export function SelectField({
  label,
  id,
  value,
  defaultValue,
  placeholder = '请选择',
  options,
  onValueChange,
  description,
  error,
  required,
  disabled,
}: SelectFieldProps) {
  const generatedId = React.useId();
  const selectId = id ?? `ah-select-${generatedId.replaceAll(':', '')}`;
  return (
    <Field
      label={label}
      htmlFor={selectId}
      {...(description ? { description } : {})}
      {...(error ? { error } : {})}
      {...(required ? { required } : {})}
    >
      <select
        id={selectId}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        className="ah-select-native"
        aria-invalid={Boolean(error) || undefined}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(required !== undefined ? { required } : {})}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {!value && !defaultValue ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface ComboboxOption extends SelectOption {
  meta?: string;
}

export interface ComboboxProps {
  id?: string;
  value?: string;
  placeholder?: string;
  options: ComboboxOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  noResultsLabel?: string;
}

export function Combobox({
  id,
  value,
  placeholder = '搜索并选择',
  options,
  onValueChange,
  disabled = false,
  noResultsLabel = '没有匹配项',
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listboxId = id ? `${id}-listbox` : undefined;
  const selected = options.find((option) => option.value === value);
  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      [option.label, option.value, option.meta]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [options, query]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return;
    onValueChange(option.value);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="ah-combobox">
      <div className="ah-combobox-control">
        <MagnifyingGlassIcon aria-hidden size={16} />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={open ? query : (selected?.label ?? '')}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const option = filtered[activeIndex];
              if (option) choose(option);
            } else if (event.key === 'Escape') {
              setQuery('');
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="ah-combobox-toggle"
          aria-label={open ? '收起选项' : '展开选项'}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <CaretDownIcon aria-hidden size={16} />
        </button>
      </div>
      {open ? (
        <div id={listboxId} role="listbox" className="ah-combobox-options">
          {filtered.length ? (
            filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={
                  index === activeIndex ? 'ah-combobox-option active' : 'ah-combobox-option'
                }
                key={option.value}
                disabled={option.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.meta ? <small>{option.meta}</small> : null}
                </span>
                {option.value === value ? <CheckIcon aria-hidden size={16} /> : null}
              </button>
            ))
          ) : (
            <div className="ah-combobox-empty">{noResultsLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export interface AdvancedSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function AdvancedSection({
  title = '高级选项',
  description = '普通流程不需要修改这些设置。',
  children,
  defaultOpen = false,
}: AdvancedSectionProps) {
  return (
    <details className="ah-advanced" open={defaultOpen}>
      <summary>{title}</summary>
      <Text as="p" color="gray" size="1">
        {description}
      </Text>
      <div className="ah-advanced-body">{children}</div>
    </details>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="ah-page-header">
      <div>
        {eyebrow ? <span className="ah-eyebrow">{eyebrow}</span> : null}
        <Heading as="h1" size="7">
          {title}
        </Heading>
        {description ? (
          <Text as="p" color="gray" size="3">
            {description}
          </Text>
        ) : null}
      </div>
      {action ? <div className="ah-page-header-action">{action}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ah-section-header">
      <div>
        <Heading as="h2" size="4">
          {title}
        </Heading>
        {description ? (
          <Text as="p" color="gray" size="2">
            {description}
          </Text>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingSkeleton({ className = '' }: { className?: string }) {
  return <span className={`ah-skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function UiButton({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixButton>) {
  return <RadixButton {...props}>{children}</RadixButton>;
}

export function UiIconButton({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixIconButton>) {
  return <RadixIconButton {...props}>{children}</RadixIconButton>;
}
