/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  cloneElement,
  createContext,
  forwardRef,
  useContext,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ElementType,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Compatibility primitives for legacy feature modules.
 *
 * New screens use the Ah* primitives directly. These small adapters keep the
 * unmounted legacy modules type-safe while the route-by-route migration finishes,
 * without exposing a second design-system dependency to feature code.
 */

function controlSize(value: unknown): 'xs' | 'sm' | 'md' | 'lg' {
  if (value === '1' || value === 'xs') return 'xs';
  if (value === '3' || value === 'lg') return 'lg';
  if (value === 'sm') return 'sm';
  return 'md';
}

function buttonVariant(value: unknown): 'filled' | 'light' | 'subtle' | 'outline' | 'default' {
  if (value === 'soft' || value === 'light') return 'light';
  if (value === 'ghost' || value === 'subtle') return 'subtle';
  if (value === 'outline') return 'outline';
  if (value === 'surface') return 'default';
  return 'filled';
}

type CompatButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'color' | 'style' | 'size'
> & {
  color?: string;
  size?: string;
  variant?: string;
  loading?: boolean;
  highContrast?: boolean;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, CompatButtonProps>(function CompatButton(
  {
    color = 'aurora',
    size = 'md',
    variant = 'solid',
    loading,
    highContrast: _highContrast,
    asChild: _asChild,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      className={['ah-compat-button', `ah-compat-button-${buttonVariant(variant)}`, className]
        .filter(Boolean)
        .join(' ')}
      data-color={color}
      data-size={controlSize(size)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? '处理中…' : children}
    </button>
  );
});

type CompatIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'style'> & {
  children?: ReactNode;
  size?: string;
  color?: string;
  variant?: string;
};

export const IconButton = forwardRef<HTMLButtonElement, CompatIconButtonProps>(
  function CompatIconButton(
    { size = 'md', variant = 'subtle', className, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        {...props}
        className={[
          'ah-compat-icon-button',
          `ah-compat-icon-button-${buttonVariant(variant)}`,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        data-size={controlSize(size)}
      >
        {children}
      </button>
    );
  },
);

type CompatTextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: string;
  variant?: string;
};

const TextFieldRoot = forwardRef<HTMLInputElement, CompatTextFieldProps>(function TextFieldRoot(
  { className, children, size: _size, variant: _variant, ...props },
  ref,
) {
  return (
    <span className={['ah-compat-text-field', className].filter(Boolean).join(' ')}>
      <input ref={ref} {...props} />
      {children ? <span className="ah-compat-text-field-slot">{children}</span> : null}
    </span>
  );
});

function TextFieldSlot({ children }: { children?: ReactNode; side?: string; pr?: string }) {
  return <span className="ah-compat-text-field-slot-content">{children}</span>;
}

export const TextField: {
  Root: typeof TextFieldRoot;
  Slot: typeof TextFieldSlot;
} = { Root: TextFieldRoot, Slot: TextFieldSlot };

export function TextArea({
  size: _size,
  ...props
}: ComponentPropsWithoutRef<'textarea'> & { size?: string }) {
  return <textarea {...props} />;
}

export function Badge({ color = 'gray', variant = 'soft', size = 'md', ...props }: any) {
  const { children, className, ...rest } = props;
  return (
    <span
      {...rest}
      className={[
        'ah-compat-badge',
        `ah-compat-badge-${color}`,
        `ah-compat-badge-${controlSize(size)}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-variant={variant}
    >
      {children}
    </span>
  );
}

export function Text({ as, color, size, ...props }: any) {
  const Component = as ?? 'span';
  const className = [
    'ah-compat-text',
    color === 'gray' ? 'ah-compat-text-muted' : undefined,
    props.className,
  ]
    .filter(Boolean)
    .join(' ');
  return <Component {...props} className={className} data-size={controlSize(size)} />;
}

export function Heading({ as = 'h2', size = '4', ...props }: any) {
  const Component: ElementType = as;
  return (
    <Component
      {...props}
      className={['ah-compat-heading', props.className].filter(Boolean).join(' ')}
      data-size={size}
    />
  );
}

export function Box({ as, ...props }: any) {
  const Component = as ?? 'div';
  return <Component {...props} />;
}

export function Flex({ align, justify, gap, ...props }: any) {
  const style = {
    display: 'flex',
    alignItems: align,
    justifyContent: justify === 'between' ? 'space-between' : justify,
    gap: typeof gap === 'number' ? `${gap * 4}px` : gap,
    ...(props.style ?? {}),
  };
  return <div {...props} style={style} />;
}

const CalloutContext = createContext<{ color?: string }>({});
function CalloutRoot({ color, children, ...props }: any) {
  return (
    <div
      {...props}
      className={['ah-compat-callout', `ah-compat-callout-${color}`, props.className]
        .filter(Boolean)
        .join(' ')}
      role={props.role}
    >
      <CalloutContext.Provider value={{ color }}>{children}</CalloutContext.Provider>
    </div>
  );
}
export const Callout = { Root: CalloutRoot };

type OverlayContextValue = { open: boolean; close: () => void };
const overlayContext = createContext<OverlayContextValue>({ open: false, close: () => undefined });

function OverlayRoot({
  open = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <overlayContext.Provider value={{ open, close: () => onOpenChange?.(false) }}>
      {children}
    </overlayContext.Provider>
  );
}

type OverlayFocusEvent = {
  currentTarget: EventTarget & HTMLElement;
  defaultPrevented: boolean;
  preventDefault: () => void;
};
type OverlayContentProps = {
  children?: ReactNode;
  maxWidth?: string | number;
  initialFocus?: string;
  onOpenAutoFocus?: (event: OverlayFocusEvent) => void;
  onCloseAutoFocus?: (event: OverlayFocusEvent) => void;
  [key: string]: unknown;
};
function OverlayContent({
  children,
  maxWidth,
  initialFocus: _initialFocus,
  onOpenAutoFocus: _onOpenAutoFocus,
  onCloseAutoFocus: _onCloseAutoFocus,
  ...props
}: OverlayContentProps) {
  const overlay = useContext(overlayContext);
  if (!overlay.open) return null;
  const contentProps = { ...(props as any) };
  delete contentProps.trapFocus;
  return (
    <div
      {...contentProps}
      role="dialog"
      aria-modal="true"
      className={['ah-compat-dialog', props.className].filter(Boolean).join(' ')}
      style={{ maxWidth, ...((props.style as object) ?? {}) }}
    >
      {children}
    </div>
  );
}

function OverlayTitle({ children, ...props }: any) {
  return <h2 {...props}>{children}</h2>;
}

function OverlayDescription({ children, ...props }: any) {
  return <p {...props}>{children}</p>;
}

function OverlayClose({ children }: { children?: ReactElement }) {
  const overlay = useContext(overlayContext);
  if (!children)
    return (
      <button type="button" onClick={overlay.close}>
        关闭
      </button>
    );
  return cloneElement(children, {
    onClick: (event: unknown) => {
      (children.props as any).onClick?.(event);
      overlay.close();
    },
  } as any);
}

export const Dialog = {
  Root: OverlayRoot,
  Content: OverlayContent,
  Title: OverlayTitle,
  Description: OverlayDescription,
  Close: OverlayClose,
};

const alertDialogContext = createContext<{ open: boolean; close: () => void }>({
  open: false,
  close: () => undefined,
});

function AlertDialogRoot({
  open = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <alertDialogContext.Provider value={{ open, close: () => onOpenChange?.(false) }}>
      {children}
    </alertDialogContext.Provider>
  );
}
function AlertDialogContent({ children, maxWidth, ...props }: any) {
  const state = useContext(alertDialogContext);
  if (!state.open) return null;
  return (
    <div
      {...props}
      role="alertdialog"
      aria-modal="true"
      className={['ah-compat-dialog', props.className].filter(Boolean).join(' ')}
      style={{ maxWidth, ...(props.style ?? {}) }}
    >
      {children}
    </div>
  );
}
function AlertDialogButton({ children, onClick, close = false, ...props }: any) {
  const state = useContext(alertDialogContext);
  const child = children as ReactElement | undefined;
  if (child && typeof child === 'object' && 'type' in child) {
    return cloneElement(child, {
      ...props,
      onClick: (event: unknown) => {
        (child.props as any).onClick?.(event);
        onClick?.(event);
        if (close) state.close();
      },
    } as any);
  }
  return (
    <button
      type="button"
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (close) state.close();
      }}
    >
      {children}
    </button>
  );
}
export const AlertDialog = {
  Root: AlertDialogRoot,
  Content: AlertDialogContent,
  Title: OverlayTitle,
  Description: OverlayDescription,
  Cancel: (props: any) => <AlertDialogButton {...props} close />,
  Action: (props: any) => <AlertDialogButton {...props} close />,
};

type TabsContextValue = { value: string; onChange: ((value: string) => void) | undefined };
const tabsContext = createContext<TabsContextValue>({ value: '', onChange: undefined });

function TabsRoot({
  value = '',
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <tabsContext.Provider value={{ value, onChange: onValueChange }}>
      {children}
    </tabsContext.Provider>
  );
}
function TabsList({ children, ...props }: any) {
  return (
    <div role="tablist" {...props}>
      {children}
    </div>
  );
}
function TabsTrigger({ value, children, ...props }: any) {
  const tabs = useContext(tabsContext);
  const activate = () => tabs.onChange?.(value);
  const onClick = props.onClick;
  const onMouseDown = props.onMouseDown;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tabs.value === value}
      {...props}
      onMouseDown={(event: any) => {
        onMouseDown?.(event);
        activate();
      }}
      onClick={(event: any) => {
        onClick?.(event);
        activate();
      }}
    >
      {children}
    </button>
  );
}
export const Tabs = { Root: TabsRoot, List: TabsList, Trigger: TabsTrigger };

export function Theme({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export type IconProps = ComponentPropsWithoutRef<'svg'> & { weight?: string };
