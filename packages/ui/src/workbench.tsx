import type { HTMLAttributes, ReactNode } from 'react';

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export type WorkbenchPanelSide = 'rail' | 'conversation' | 'inspector';

export interface WorkbenchProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  topbar?: ReactNode;
  rail?: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  terminal?: ReactNode;
  railCollapsed?: boolean;
  inspectorCollapsed?: boolean;
  inspectorOpen?: boolean;
  labels?: Partial<Record<WorkbenchPanelSide, string>>;
}

/**
 * Structural workbench contract. It only owns panel geometry; domain data and
 * interactions stay with the feature that renders each slot.
 */
export function Workbench({
  topbar,
  rail,
  children,
  inspector,
  terminal,
  railCollapsed = false,
  inspectorCollapsed = false,
  inspectorOpen = true,
  labels,
  className,
  ...props
}: WorkbenchProps) {
  return (
    <div
      {...props}
      className={cx('ah-workbench', className)}
      data-rail-present={Boolean(rail)}
      data-inspector-present={Boolean(inspector)}
      data-rail-collapsed={railCollapsed}
      data-inspector-collapsed={inspectorCollapsed}
      data-inspector-open={inspectorOpen}
    >
      <header className="ah-workbench-topbar">{topbar}</header>
      <div className="ah-workbench-body">
        <aside
          className="ah-workbench-rail"
          aria-label={labels?.rail ?? '会话列表'}
          aria-hidden={!rail || undefined}
        >
          {rail}
        </aside>
        <main className="ah-workbench-conversation" aria-label={labels?.conversation ?? '对话'}>
          {children}
        </main>
        <aside
          className="ah-workbench-inspector"
          aria-label={labels?.inspector ?? '检查器'}
          aria-hidden={!inspector || undefined}
        >
          {inspector}
        </aside>
      </div>
      {terminal ? (
        <section className="ah-workbench-terminal" aria-label="Terminal">
          {terminal}
        </section>
      ) : null}
    </div>
  );
}

export function WorkbenchPanel({
  side,
  title,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  side: WorkbenchPanelSide;
  title?: string;
  children: ReactNode;
}) {
  return (
    <section
      {...props}
      className={cx('ah-workbench-panel', `ah-workbench-panel-${side}`, className)}
      aria-label={title ?? props['aria-label']}
    >
      {title ? <h2 className="ah-workbench-panel-title">{title}</h2> : null}
      <div className="ah-workbench-panel-content">{children}</div>
    </section>
  );
}
