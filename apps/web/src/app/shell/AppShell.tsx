import {
  AhButton,
  AhDrawer,
  AhStatusPill,
  Bell,
  Bot,
  Braces,
  ChevronLeft,
  ChevronRight,
  CubeIcon,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Moon,
  Network,
  Search,
  Settings,
  Sun,
  useAgentHubTheme,
  type IconProps,
} from '@agenthub/ui';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { realtime } from '../../lib/realtime';
import { AgentHubLogo } from '../../components/AgentHubLogo';

const CommandPalette = lazy(() =>
  import('./CommandPalette').then((module) => ({ default: module.CommandPalette })),
);

type NavigationItem = {
  to: string;
  label: string;
  description: string;
  icon: ComponentType<IconProps>;
  shortcut?: string;
};

const primaryNavigation: NavigationItem[] = [
  { to: '/home', label: '首页', description: '关注事项与最近工作', icon: LayoutDashboard },
  { to: '/projects', label: '项目', description: '工程上下文与工作入口', icon: FolderKanban },
  { to: '/agents', label: 'Agent 中心', description: 'Agent 身份与可用性', icon: Bot },
  { to: '/prompts', label: 'Prompt 库', description: '可复用的 Prompt 资产', icon: Braces },
  {
    to: '/settings/appearance',
    label: '设置',
    description: '外观、账号与系统设置',
    icon: Settings,
  },
];

const secondaryNavigation: NavigationItem[] = [
  {
    to: '/agents/runtime',
    label: '运行环境',
    description: 'Local、Docker 与远程执行环境',
    icon: CubeIcon,
  },
  {
    to: '/agents/nodes',
    label: '远程节点',
    description: '连接和管理远程 Agent 节点',
    icon: Network,
  },
];

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={`flex items-center ${collapsed ? 'justify-center px-2 pt-3 pb-1' : 'justify-between px-3 pt-3 pb-1 2xl:px-4 2xl:pt-4'}`}
    >
      <div
        className={`group flex items-center overflow-hidden ${collapsed ? 'h-[var(--sidebar-control-size)] w-[var(--sidebar-control-size)] justify-center' : 'min-w-0 gap-2.5'}`}
      >
        <AgentHubLogo
          className="h-7 w-7 shrink-0 rounded-[9px] border border-black/[0.04] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-sm)] transition-opacity duration-[var(--motion-fast)] group-hover:opacity-90 2xl:h-8 2xl:w-8"
          aria-label="AgentHub"
        />
        {!collapsed && (
          <span className="truncate text-[15px] font-semibold tracking-[-0.025em] text-[hsl(var(--foreground))] 2xl:text-[16px]">
            AgentHub
          </span>
        )}
      </div>
    </div>
  );
}

function sidebarItemClass(active: boolean, collapsed: boolean): string {
  return [
    'sidebar-control group/item relative flex items-center text-[length:var(--sidebar-font-size)] transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-standard)] active:bg-[hsl(var(--surface-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--sidebar-bg))]',
    collapsed
      ? 'h-[var(--sidebar-control-size)] w-[var(--sidebar-control-size)] shrink-0 justify-center rounded-[10px]'
      : 'gap-2.5 rounded-[8px] px-2.5 py-1.5 2xl:gap-3 2xl:px-3',
    active
      ? 'bg-[hsl(var(--sidebar-item-active-bg))] font-semibold text-[hsl(var(--sidebar-item-active-fg))] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.1)]'
      : 'font-medium text-[hsl(var(--foreground-subtle))] hover:bg-[hsl(var(--surface-hover))]/75 hover:text-[hsl(var(--foreground))] dark:hover:bg-white/[0.05]',
  ].join(' ');
}

function Navigation({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        className={`mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 2xl:mt-2 2xl:gap-1 2xl:px-3 ${collapsed ? 'items-center' : ''}`}
        aria-label="主导航"
      >
        {primaryNavigation.map(({ to, label, icon: Icon, shortcut }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/home' || to === '/projects'}
            className={({ isActive }) => sidebarItemClass(isActive, collapsed)}
            onClick={onNavigate}
            aria-label={label}
          >
            <Icon className="sidebar-icon shrink-0" aria-hidden size={18} weight="regular" />
            {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
            {!collapsed && shortcut ? (
              <kbd className="ml-auto rounded-[5px] bg-[hsl(var(--surface))]/70 px-1.5 py-0.5 text-[10px] text-[hsl(var(--foreground-faint))]">
                {shortcut}
              </kbd>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <div className="my-3 h-px w-full bg-[hsl(var(--sidebar-border))]/70" aria-hidden="true" />
      <nav aria-label="Infrastructure" className="flex flex-col gap-0.5">
        {!collapsed && (
          <span className="px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--sidebar-section-label))]">
            Infrastructure
          </span>
        )}
        <div className={`mt-1 flex flex-col gap-0.5 ${collapsed ? 'items-center' : ''}`}>
          {secondaryNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) => sidebarItemClass(isActive, collapsed)}
              onClick={onNavigate}
              aria-label={label}
            >
              <Icon className="sidebar-icon shrink-0" aria-hidden size={18} weight="regular" />
              {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function ProfileSurface({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <button
      type="button"
      className={`group/profile flex min-h-[52px] w-full items-center gap-2 rounded-[var(--radius-lg)] border border-[hsl(var(--sidebar-border))]/70 bg-[hsl(var(--sidebar-bg))]/50 px-2.5 py-2.5 text-left shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,background-color] duration-[var(--motion-fast)] hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-hover))]/60 hover:shadow-[var(--shadow-md)] ${collapsed ? 'justify-center px-1.5' : ''}`}
      aria-label="Kwan，管理员账户"
    >
      <span className="avatar-glow relative shrink-0">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(var(--primary-hover))]/50 bg-[hsl(var(--primary))] text-[10px] font-semibold text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-sm)]">
          K
        </span>
      </span>
      {!collapsed && (
        <span className="grid min-w-0 flex-1">
          <strong className="truncate text-[13px] text-[hsl(var(--foreground))]">Kwan</strong>
          <small className="text-[11px] text-[hsl(var(--foreground-faint))]">Admin</small>
        </span>
      )}
      {!collapsed && (
        <ChevronRight
          className="ml-auto text-[hsl(var(--foreground-faint))]"
          aria-hidden
          size={15}
        />
      )}
    </button>
  );
}

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [connection, setConnection] = useState<'连接中' | '已连接' | '已断开'>('已断开');
  const location = useLocation();
  const navigate = useNavigate();
  const { preference, setPreference, sidebarCollapsed, sidebarPreference, setSidebarCollapsed } =
    useAgentHubTheme();

  useEffect(() => realtime.onState(setConnection), []);
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (sidebarPreference === 'expanded') setSidebarCollapsed(false);
    if (sidebarPreference === 'collapsed') setSidebarCollapsed(true);
  }, [setSidebarCollapsed, sidebarPreference]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable);
      if (
        !isEditing &&
        !location.pathname.startsWith('/workspace') &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'b' &&
        sidebarPreference === 'remember'
      ) {
        event.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [location.pathname, setSidebarCollapsed, sidebarCollapsed, sidebarPreference]);

  function openCommand() {
    setCommandOpen(true);
  }

  const contextProjectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];

  return (
    <div
      className="app-shell flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
      data-shell="app-shell"
      data-agenthub-version="1.1.0"
      data-design-system="pinharness"
      data-sidebar-state={sidebarCollapsed ? 'collapsed' : 'expanded'}
    >
      <a
        className="fixed left-3 top-3 z-[3000] -translate-y-24 rounded-[var(--radius)] bg-[hsl(var(--foreground))] px-3 py-2 text-xs font-semibold text-[hsl(var(--surface))] shadow-[var(--shadow-lg)] transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={`app-sidebar relative hidden h-full shrink-0 flex-col border-r border-[hsl(var(--sidebar-border))]/80 transition-[width,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] md:flex ${sidebarCollapsed ? 'w-[var(--sidebar-collapsed-width)]' : 'w-[var(--sidebar-width)]'}`}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[hsl(var(--surface))]/70" />
          <Brand collapsed={sidebarCollapsed} />
          <Navigation collapsed={sidebarCollapsed} />
          <div
            className={`mt-1.5 border-t border-[hsl(var(--sidebar-border))]/60 py-2.5 ${sidebarCollapsed ? 'flex flex-col items-center px-2' : 'px-3 2xl:px-4'}`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2'}`}>
              <div
                className="inline-flex items-center"
                role="status"
                aria-label={`实时连接${connection}`}
              >
                <AhStatusPill
                  status={
                    connection === '已连接'
                      ? 'ONLINE'
                      : connection === '连接中'
                        ? 'PENDING'
                        : 'OFFLINE'
                  }
                  label={connection}
                />
              </div>
              {!sidebarCollapsed && (
                <span className="ml-auto text-[11px] text-[hsl(var(--foreground-faint))]">
                  实时连接
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className={`group/toggle mx-2 mb-1 flex min-h-[var(--sidebar-item-height)] items-center gap-2 rounded-[8px] px-2.5 text-left text-[12px] font-semibold text-[hsl(var(--foreground-subtle))] transition-[background-color,color] duration-[var(--motion-fast)] hover:bg-[hsl(var(--surface-hover))]/75 hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60 disabled:cursor-not-allowed disabled:opacity-50 ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            onClick={() => {
              if (sidebarPreference === 'remember') setSidebarCollapsed(!sidebarCollapsed);
            }}
            disabled={sidebarPreference !== 'remember'}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            title={`${sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'} (Ctrl/⌘ B)`}
          >
            {sidebarCollapsed ? (
              <ChevronRight aria-hidden size={17} />
            ) : (
              <ChevronLeft aria-hidden size={17} />
            )}
            {!sidebarCollapsed && <span>{sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}</span>}
            {!sidebarCollapsed && (
              <kbd className="ml-auto rounded-[5px] bg-[hsl(var(--surface-hover))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--foreground-faint))]">
                ⌘ B
              </kbd>
            )}
          </button>
          <div
            className={`border-t border-[hsl(var(--sidebar-border))]/60 p-2.5 ${sidebarCollapsed ? 'px-2' : 'px-3 2xl:px-4'}`}
          >
            <ProfileSurface collapsed={sidebarCollapsed} />
          </div>
        </aside>
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <header
            className="flex h-14 shrink-0 items-center gap-3 border-b border-[hsl(var(--border))]/70 bg-[hsl(var(--background))] px-4 sm:px-6"
            data-shell-topbar="true"
          >
            <div className="flex items-center gap-2 md:hidden">
              <AhButton
                className="grid h-9 w-9 place-items-center border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0 text-[hsl(var(--foreground-subtle))]"
                variant="default"
                color="gray"
                onClick={() => setDrawerOpen(true)}
                aria-label="打开导航"
                type="button"
              >
                <Menu size={19} />
              </AhButton>
            </div>
            <button
              type="button"
              className="flex h-9 min-h-9 w-full max-w-[440px] items-center gap-2.5 rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-left text-[13px] text-[hsl(var(--foreground-faint))] shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,color] duration-[var(--motion-fast)] hover:border-[hsl(var(--border-strong))] hover:text-[hsl(var(--foreground-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60"
              onClick={openCommand}
              aria-label="搜索与跳转"
            >
              <Search aria-hidden size={16} />
              <span>搜索项目 / Agent / Prompt...</span>
              <kbd className="ml-auto rounded-[5px] bg-[hsl(var(--surface-muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--foreground-faint))]">
                ⌘ K
              </kbd>
            </button>
            <div className="ml-auto hidden items-center gap-1.5 md:flex">
              <button
                type="button"
                className={`grid h-9 w-9 place-items-center rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground-subtle))] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)] hover:-translate-y-px hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60 ${preference === 'light' ? 'border-[hsl(var(--primary))]/25 bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]' : ''}`}
                onClick={() => setPreference('light')}
                aria-label="浅色主题"
                title="浅色主题"
              >
                <Sun aria-hidden size={18} weight="regular" />
              </button>
              <button
                type="button"
                className={`grid h-9 w-9 place-items-center rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground-subtle))] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)] hover:-translate-y-px hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60 ${preference === 'dark' ? 'border-[hsl(var(--primary))]/25 bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]' : ''}`}
                onClick={() => setPreference('dark')}
                aria-label="深色主题"
                title="深色主题"
              >
                <Moon aria-hidden size={18} weight="regular" />
              </button>
              <button
                type="button"
                className="grid h-9 w-9 place-items-center rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground-subtle))] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)] hover:-translate-y-px hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60"
                aria-label="通知"
                title="通知"
              >
                <Bell aria-hidden size={18} />
              </button>
            </div>
          </header>
          <main
            id="main-content"
            className="ambient-canvas app-main min-h-0 flex-1 overflow-y-auto px-4 pb-14 pt-4 outline-none sm:px-6 sm:pb-12 sm:pt-6"
            tabIndex={-1}
          >
            <div key={location.pathname} className="route-stage h-full min-h-0">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <AhDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="AgentHub"
        position="left"
      >
        <Brand />
        <Navigation onNavigate={() => setDrawerOpen(false)} />
        <ProfileSurface />
      </AhDrawer>

      {commandOpen ? (
        <Suspense fallback={null}>
          <CommandPalette
            open
            onClose={() => setCommandOpen(false)}
            onNavigate={(href) => navigate(href)}
            {...(contextProjectId ? { contextProjectId } : {})}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
