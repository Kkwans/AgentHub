import * as React from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { DismissableLayer } from '@radix-ui/react-dismissable-layer';
import { hideOthers } from 'aria-hidden';
import { XIcon } from '@phosphor-icons/react/X';

import { Select as PinSelect } from '../pinharness/ui/select.js';

export type FormDialogSize = 'small' | 'medium' | 'large';

const FOCUSABLE_CONTROL_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), button:not([disabled])';

function resolveFocusableControl(element: HTMLElement): HTMLElement | undefined {
  if (element.matches(FOCUSABLE_CONTROL_SELECTOR)) return element;
  return element.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR) ?? undefined;
}

// aria-hidden is reference-counted; independently hiding siblings would hide
// both when two dialogs mount together. Keep one screen-reader isolation lease.
// Keyboard and focus stacking remain owned by Radix (including Select portals).
const modalVisibility = new WeakMap<
  Document,
  {
    nodes: Set<HTMLElement>;
    restore?: (() => void) | undefined;
  }
>();
function isolateModal(content: HTMLElement): () => void {
  const document = content.ownerDocument;
  let state = modalVisibility.get(document);
  if (!state) {
    state = { nodes: new Set() };
    modalVisibility.set(document, state);
  }
  const update = () => {
    state.restore?.();
    state.restore = undefined;
    const top = [...state.nodes].at(-1);
    if (top) state.restore = hideOthers(top);
  };
  state.nodes.add(content);
  update();
  return () => {
    state.nodes.delete(content);
    update();
  };
}

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: FormDialogSize;
  fullScreen?: boolean;
  canClose?: boolean;
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

export function FormDialog(props: FormDialogProps) {
  // Each open lifetime owns its focus callbacks and opener. Delayed cleanup
  // from an earlier mount must never read a newly opened dialog's refs.
  return props.open ? <OpenFormDialog {...props} /> : null;
}

function OpenFormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'medium',
  fullScreen = false,
  canClose = true,
  labelledBy,
  describedBy,
  onOpenAutoFocus: _onOpenAutoFocus,
  onCloseAutoFocus: _onCloseAutoFocus,
}: FormDialogProps) {
  const contentRef = React.useRef<HTMLElement | null>(null);
  const callbacks = React.useRef({ onOpenChange, _onOpenAutoFocus, _onCloseAutoFocus, canClose });
  callbacks.current = { onOpenChange, _onOpenAutoFocus, _onCloseAutoFocus, canClose };
  const opener = React.useRef<HTMLElement | null>(null);
  const lastContent = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open || !contentRef.current) return;
    return isolateModal(contentRef.current);
  }, [open]);

  const autoFocusEvent = (content: HTMLElement) => ({
    currentTarget: content,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  });

  const generatedTitleId = React.useId();
  if (!open) return null;
  const titleId = labelledBy ?? `ah-dialog-title-${generatedTitleId.replaceAll(':', '')}`;
  const descriptionId = describedBy ?? (description ? `${titleId}-description` : undefined);
  return createPortal(
    <div
      className="ah-dialog-backdrop"
      data-fullscreen={fullScreen || undefined}
      role="presentation"
    >
      <FocusScope
        asChild
        trapped={open}
        loop
        onMountAutoFocus={(event) => {
          const content = contentRef.current;
          if (!content) return;
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          lastContent.current = content;
          const custom = autoFocusEvent(content);
          callbacks.current._onOpenAutoFocus?.(custom);
          if (custom.defaultPrevented) {
            event.preventDefault();
            return;
          }
          const invalid = Array.from(
            content.querySelectorAll<HTMLElement>('[aria-invalid="true"], :invalid'),
          )
            .map(resolveFocusableControl)
            .find((element) => element !== undefined);
          if (invalid) {
            invalid.focus();
            event.preventDefault();
          }
        }}
        onUnmountAutoFocus={(event) => {
          // FocusScope restores asynchronously. Do not steal focus from a newer
          // route/dialog that has already deliberately focused another element.
          event.preventDefault();
          const content = lastContent.current;
          if (!content) return;
          const custom = autoFocusEvent(content);
          callbacks.current._onCloseAutoFocus?.(custom);
          if (custom.defaultPrevented) return;
          const active = document.activeElement;
          if (
            active !== document.body &&
            active instanceof HTMLElement &&
            active.isConnected &&
            !content.contains(active)
          )
            return;
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <DismissableLayer
          asChild
          disableOutsidePointerEvents
          onPointerDownOutside={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (!callbacks.current.canClose) {
              event.preventDefault();
              return;
            }
            // DismissableLayer selects only the top layer. Wait for child
            // keyboard handlers so their preventDefault can consume Escape.
            queueMicrotask(() => {
              if (
                !event.defaultPrevented &&
                contentRef.current?.isConnected &&
                callbacks.current.canClose
              )
                callbacks.current.onOpenChange(false);
            });
          }}
        >
          <section
            ref={contentRef}
            tabIndex={-1}
            className={`ah-dialog ah-dialog-${size}${fullScreen ? ' ah-dialog-fullscreen' : ''}`}
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
                disabled={!canClose}
                onClick={() => {
                  if (callbacks.current.canClose) callbacks.current.onOpenChange(false);
                }}
              >
                <XIcon aria-hidden size={18} />
              </button>
            </div>
            <div className="ah-dialog-body">{children}</div>
            {footer ? <div className="ah-dialog-footer">{footer}</div> : null}
          </section>
        </DismissableLayer>
      </FocusScope>
    </div>,
    document.body,
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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      canClose={!pending}
    >
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
        {...(value === undefined ? {} : { value })}
        {...(defaultValue === undefined ? {} : { defaultValue })}
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
  defaultValue?: string;
  placeholder?: string;
  options: ComboboxOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  noResultsLabel?: string;
}

export function Combobox({
  id,
  value,
  defaultValue,
  placeholder = '搜索并选择',
  options,
  onValueChange,
  disabled = false,
  noResultsLabel = '没有匹配项',
}: ComboboxProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : uncontrolledValue;
  return (
    <PinSelect
      {...(id === undefined ? {} : { id })}
      {...(selectedValue === undefined ? {} : { value: selectedValue })}
      {...(placeholder === undefined ? {} : { placeholder })}
      options={options.map(({ meta, ...option }) => ({
        ...option,
        ...(meta && !option.description ? { description: meta } : {}),
      }))}
      {...(disabled === undefined ? {} : { disabled })}
      searchable
      clearable={false}
      noResultsLabel={noResultsLabel}
      onValueChange={(nextValue) => {
        if (!isControlled) setUncontrolledValue(nextValue);
        onValueChange(nextValue);
      }}
    />
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

const AhTabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
>(function AhTabsTrigger({ value, children, onClick, ...props }, ref) {
  const tabs = React.useContext(ahTabsContext);
  return (
    <button
      ref={ref}
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
});
AhTabsTrigger.displayName = 'AhTabsTrigger';

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
