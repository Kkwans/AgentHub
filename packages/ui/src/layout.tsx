import type { HTMLAttributes, ReactNode } from 'react';

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  label?: string;
}

export function Toolbar({ children, label = '工具栏', className, ...props }: ToolbarProps) {
  return (
    <div {...props} role="toolbar" aria-label={label} className={cx('ah-toolbar', className)}>
      {children}
    </div>
  );
}

export interface WorkbenchToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode;
  /** Leading controls such as the session title or search trigger. */
  start?: ReactNode;
  /** Trailing controls such as status, overflow and panel actions. */
  end?: ReactNode;
  label?: string;
}

/**
 * A compact toolbar primitive for dense workbench surfaces.
 *
 * The wrapper owns alignment and overflow only. Feature code still owns the
 * actual controls and their business actions.
 */
export function WorkbenchToolbar({
  children,
  start,
  end,
  label = '工作台工具栏',
  className,
  ...props
}: WorkbenchToolbarProps) {
  return (
    <div
      {...props}
      role="toolbar"
      aria-label={label}
      className={cx('ah-workbench-toolbar', 'ah-toolbar', className)}
    >
      {start ? <div className="ah-workbench-toolbar-start">{start}</div> : null}
      {children ? <div className="ah-workbench-toolbar-content">{children}</div> : null}
      {end ? <div className="ah-workbench-toolbar-end">{end}</div> : null}
    </div>
  );
}

export interface LocalNavItem {
  href: string;
  label: string;
  active?: boolean;
  count?: number;
}

export function LocalNav({
  items,
  label = '页面导航',
  className,
}: {
  items: readonly LocalNavItem[];
  label?: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cx('ah-local-nav', className)}>
      {items.map((item) => (
        <a key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}>
          <span>{item.label}</span>
          {typeof item.count === 'number' ? <small>{item.count}</small> : null}
        </a>
      ))}
    </nav>
  );
}

export function SettingRow({
  label,
  description,
  control,
  className,
}: {
  label: string;
  description?: string;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('ah-setting-row', className)}>
      <div className="ah-setting-row-copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="ah-setting-row-control">{control}</div>
    </div>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('ah-panel-header', className)}>
      <div className="ah-panel-header-copy">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {actions ? <div className="ah-panel-header-actions">{actions}</div> : null}
    </header>
  );
}

export interface WorkbenchPanelHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Panel header with an optional eyebrow and description for workbench slots.
 * It intentionally shares the same title/description geometry as PanelHeader
 * while exposing a richer semantic shape for the three-column shell.
 */
export function WorkbenchPanelHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: WorkbenchPanelHeaderProps) {
  return (
    <div className={cx('ah-workbench-panel-header', className)} role="group">
      <div className="ah-workbench-panel-header-copy">
        {eyebrow ? <span className="ah-workbench-panel-eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <span>{description}</span> : null}
      </div>
      {actions ? <div className="ah-workbench-panel-header-actions">{actions}</div> : null}
    </div>
  );
}

export type PageFrameMode = 'standard' | 'wide' | 'narrow' | 'full';

export interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  mode?: PageFrameMode;
}

export function PageFrame({ children, mode = 'standard', className, ...props }: PageFrameProps) {
  return (
    <div {...props} className={cx('ah-page-frame', className)} data-page-width={mode}>
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
      {tabs ? (
        <nav className="ah-context-tabs" aria-label="项目上下文">
          {tabs}
        </nav>
      ) : null}
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

// v1 names are additive aliases so existing feature imports remain stable while
// new consumers can use the architecture vocabulary from the design contract.
export const AhPageHeader = ScreenHeader;
export const AhToolbar = Toolbar;
export const AhWorkbenchToolbar = WorkbenchToolbar;
export const AhLocalNav = LocalNav;
export const AhSettingRow = SettingRow;
export const AhPanelHeader = PanelHeader;
export const AhWorkbenchPanelHeader = WorkbenchPanelHeader;
export const AhEntityList = EntityList;
export const AhEntityRow = EntityRow;
export const AhInspectorPanel = InspectorPanel;
export const AhSettingsLayout = SettingsLayout;
