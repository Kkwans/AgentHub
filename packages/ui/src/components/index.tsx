import * as React from 'react';
import { CheckIcon } from '@phosphor-icons/react/Check';
import { CaretDownIcon } from '@phosphor-icons/react/CaretDown';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/MagnifyingGlass';
import { XIcon } from '@phosphor-icons/react/X';

export type FormDialogSize = 'small' | 'medium' | 'large';

const FOCUSABLE_CONTROL_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), button:not([disabled])';

function resolveFocusableControl(element: HTMLElement): HTMLElement | undefined {
  if (element.matches(FOCUSABLE_CONTROL_SELECTOR)) return element;
  return element.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR) ?? undefined;
}

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
  onOpenAutoFocus?: (event: {
    currentTarget: EventTarget & HTMLElement;
    defaultPrevented: boolean;
    preventDefault: () => void;
  }) => void;
  onCloseAutoFocus?: (event: {
    currentTarget: EventTarget & HTMLElement;
    defaultPrevented: boolean;
    preventDefault: () => void;
  }) => void;
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
  onOpenAutoFocus: _onOpenAutoFocus,
  onCloseAutoFocus: _onCloseAutoFocus,
}: FormDialogProps) {
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (open) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement !== document.body) {
        restoreFocusRef.current ??= activeElement;
      }
      const focusDialogControl = () => {
        const content = document.querySelector<HTMLElement>('.ah-dialog');
        if (!content) return;
        const event = {
          currentTarget: content,
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
        };
        _onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        const firstInvalid = Array.from(
          content.querySelectorAll<HTMLElement>('[aria-invalid="true"], :invalid'),
        )
          .map(resolveFocusableControl)
          .find((element): element is HTMLElement => Boolean(element));
        const firstControl = content.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR);
        (firstInvalid ?? firstControl)?.focus();
      };
      const timer = window.setTimeout(focusDialogControl, 25);
      return () => window.clearTimeout(timer);
    }
    const opener = restoreFocusRef.current;
    restoreFocusRef.current = null;
    const content = document.querySelector<HTMLElement>('.ah-dialog');
    if (content) {
      const event = {
        currentTarget: content,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      _onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return undefined;
    }
    if (opener?.isConnected) opener.focus();
    return undefined;
  }, [open, _onCloseAutoFocus, _onOpenAutoFocus]);

  const generatedTitleId = React.useId();
  if (!open) return null;
  const titleId = labelledBy ?? `ah-dialog-title-${generatedTitleId.replaceAll(':', '')}`;
  const descriptionId = describedBy ?? (description ? `${titleId}-description` : undefined);
  return (
    <div className="ah-dialog-backdrop" role="presentation">
      <section
        className={`ah-dialog ah-dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(descriptionId ? { 'aria-describedby': descriptionId } : {})}
      >
        <div className="ah-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            type="button"
            className="ah-dialog-close"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
          >
            <XIcon aria-hidden size={18} />
          </button>
        </div>
        <div className="ah-dialog-body">{children}</div>
        {footer ? <div className="ah-dialog-footer">{footer}</div> : null}
      </section>
    </div>
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
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="ah-dialog-footer">
        <button
          type="button"
          className="ah-dialog-secondary"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={destructive ? 'ah-dialog-danger' : 'ah-dialog-primary'}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? '处理中…' : confirmLabel}
        </button>
      </div>
    </FormDialog>
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
  const control = React.isValidElement(children)
    ? (() => {
        const child = children as React.ReactElement<Record<string, unknown>>;
        const existingDescribedBy =
          typeof child.props['aria-describedby'] === 'string'
            ? child.props['aria-describedby']
            : undefined;
        const mergedDescribedBy =
          [existingDescribedBy, describedBy].filter(Boolean).join(' ') || undefined;
        return React.cloneElement(child, {
          ...(mergedDescribedBy ? { 'aria-describedby': mergedDescribedBy } : {}),
          ...(error ? { 'aria-invalid': true } : {}),
        });
      })()
    : children;

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
      <div className="ah-field-control">{control}</div>
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

export type FormTextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> &
  Pick<FieldProps, 'label' | 'description' | 'error' | 'required'>;

export function FormTextField({
  label,
  description,
  error,
  required,
  id,
  name,
  autoComplete = 'off',
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
      <input
        {...(id ? { id } : {})}
        {...(name || id ? { name: name ?? id } : {})}
        className={['ah-field-input', props.className].filter(Boolean).join(' ')}
        {...props}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error) || undefined}
      />
    </Field>
  );
}

export type FormTextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> &
  Pick<FieldProps, 'label' | 'description' | 'error' | 'required'>;

export function FormTextArea({
  label,
  description,
  error,
  required,
  id,
  name,
  autoComplete = 'off',
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
      <textarea
        {...(id ? { id } : {})}
        {...(name || id ? { name: name ?? id } : {})}
        className={['ah-field-textarea', props.className].filter(Boolean).join(' ')}
        {...props}
        autoComplete={autoComplete}
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
      <Combobox
        id={selectId}
        {...((value ?? defaultValue) ? { value: value ?? defaultValue } : {})}
        placeholder={placeholder}
        options={options}
        {...(disabled === undefined ? {} : { disabled })}
        onValueChange={(next) => onValueChange?.(next)}
      />
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

type AhTabsContextValue = {
  value: string;
  onValueChange?: (value: string) => void;
};

const ahTabsContext = React.createContext<AhTabsContextValue>({ value: '' });

function AhTabsRoot({
  value = '',
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <ahTabsContext.Provider value={{ value, ...(onValueChange ? { onValueChange } : {}) }}>
      {children}
    </ahTabsContext.Provider>
  );
}

function AhTabsList({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="tablist" {...props}>
      {children}
    </div>
  );
}

function AhTabsTrigger({
  value,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const tabs = React.useContext(ahTabsContext);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tabs.value === value}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.onValueChange?.(value);
      }}
    >
      {children}
    </button>
  );
}

export const AhTabs = { Root: AhTabsRoot, List: AhTabsList, Trigger: AhTabsTrigger };

export function AdvancedSection({
  title = '高级选项',
  description = '普通流程不需要修改这些设置。',
  children,
  defaultOpen = false,
}: AdvancedSectionProps) {
  return (
    <details className="ah-advanced" open={defaultOpen}>
      <summary>{title}</summary>
      <p>{description}</p>
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
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
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
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingSkeleton({ className = '' }: { className?: string }) {
  return <span className={`ah-skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function UiButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props}>{children}</button>;
}

export function UiIconButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props}>{children}</button>;
}
