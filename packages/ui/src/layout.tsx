import type { HTMLAttributes, ReactNode } from 'react';

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PageFrame({ children, className, ...props }: PageFrameProps) {
  return (
    <div {...props} className={cx('ah-page-frame', className)}>
      {children}
    </div>
  );
}

export function ScreenHeader({
  title,
  description,
  eyebrow,
  actions,
  compact = false,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={cx('ah-screen-header', compact && 'ah-screen-header-compact')}>
      <div className="ah-screen-header-copy">
        {eyebrow ? <span className="ah-screen-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ah-screen-header-actions">{actions}</div> : null}
    </header>
  );
}

export function ContextHeader({
  identity,
  facts,
  actions,
  tabs,
}: {
  identity: ReactNode;
  facts?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <section className="ah-context-header">
      <div className="ah-context-header-bar">
        <div className="ah-context-header-identity">{identity}</div>
        {facts ? <div className="ah-context-header-facts">{facts}</div> : null}
        {actions ? <div className="ah-context-header-actions">{actions}</div> : null}
      </div>
      {tabs ? <nav className="ah-context-tabs" aria-label="项目上下文">{tabs}</nav> : null}
    </section>
  );
}

export function EntityList({
  label,
  header,
  children,
  className,
}: {
  label: string;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('ah-entity-list', className)} aria-label={label}>
      {header ? <div className="ah-entity-list-header">{header}</div> : null}
      <div className="ah-entity-list-body">{children}</div>
    </section>
  );
}

export function EntityRow({
  children,
  selected = false,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode; selected?: boolean }) {
  return (
    <article
      {...props}
      className={cx('ah-entity-row', selected && 'ah-entity-row-selected', className)}
      aria-current={selected ? 'true' : undefined}
    >
      {children}
    </article>
  );
}

export function InspectorPanel({
  title,
  actions,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cx('ah-inspector-panel', className)}
      aria-label={typeof title === 'string' ? title : '检查器'}
    >
      <header className="ah-inspector-header">
        <div>{title}</div>
        {actions ? <div className="ah-inspector-actions">{actions}</div> : null}
      </header>
      <div className="ah-inspector-content">{children}</div>
      {footer ? <footer className="ah-inspector-footer">{footer}</footer> : null}
    </aside>
  );
}

export function SettingsLayout({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ah-settings-layout">
      <div className="ah-settings-navigation">{navigation}</div>
      <div className="ah-settings-content">{children}</div>
    </div>
  );
}
