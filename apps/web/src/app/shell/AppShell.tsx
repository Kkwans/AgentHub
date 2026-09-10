import {
  AhStatusPill,
  Bot,
  Braces,
  ChevronLeft,
  ChevronRight,
  CubeIcon,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MobileDrawerPanel,
  Network,
  Search,
  Settings,
  Moon,
  Sun,
  useAgentHubTheme,
  type IconProps,
} from '@agenthub/ui';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { realtime } from '../../lib/realtime';
import { AgentHubLogo } from '../../components/AgentHubLogo';
import { useAuthUser } from '../../components/AccessGate';

const CommandPalette = lazy(() =>
  import('./CommandPalette').then((module) => ({ default: module.CommandPalette })),
);

// PinHarness source breakpoints: render a single mobile surface below 768px
// and keep the desktop rail compact until the workbench has 1320px of room.
const MOBILE_NAV_BREAKPOINT = 768;
const AUTO_COLLAPSE_BREAKPOINT = 1320;

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

function Brand({
  collapsed = false,
  onToggle,
  toggleDisabled = false,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  toggleDisabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center ${collapsed ? 'flex-col gap-1.5 px-2 pt-3 pb-1' : 'justify-between px-3 pt-3 pb-1 2xl:px-4 2xl:pt-4'}`}
    >
      <Link
        to="/home"
        className={`group flex items-center overflow-hidden ${collapsed ? 'h-[var(--sidebar-control-size)] w-[var(--sidebar-control-size)] justify-center' : 'min-w-0 gap-2.5'}`}
        aria-label="AgentHub 首页"
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
      </Link>
      {onToggle ? (
        <button
          type="button"
          className={`group/toggle flex shrink-0 items-center justify-center rounded-[10px] text-[hsl(var(--foreground-faint))] transition-[background-color,color] duration-[var(--motion-fast)] hover:bg-[hsl(var(--surface-hover))]/75 hover:text-[hsl(var(--foreground))] active:bg-[hsl(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-50 ${collapsed ? 'h-[var(--sidebar-control-size)] w-[var(--sidebar-control-size)]' : 'h-7 w-7'}`}
          onClick={onToggle}
          disabled={toggleDisabled}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? (
            <ChevronRight aria-hidden size={16} />
          ) : (
            <ChevronLeft aria-hidden size={16} />
          )}
        </button>
      ) : null}
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
            end
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

function ProfileSurface({
  collapsed = false,
  username,
}: {
  collapsed?: boolean;
  username?: string | undefined;
}) {
  const displayName = username?.trim() || 'Kwan';
  const initial = displayName.slice(0, 1).toUpperCase() || 'K';
  return (
    <button
      type="button"
      className={`group/profile flex min-h-[52px] w-full items-center gap-2 rounded-[var(--radius-lg)] border border-[hsl(var(--sidebar-border))]/70 bg-[hsl(var(--sidebar-bg))]/50 px-2.5 py-2.5 text-left shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,background-color] duration-[var(--motion-fast)] hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-hover))]/60 hover:shadow-[var(--shadow-md)] ${collapsed ? 'justify-center px-1.5' : ''}`}
      aria-label={`${displayName}，管理员账户`}
    >
      <span className="avatar-glow relative shrink-0">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(var(--primary-hover))]/50 bg-[hsl(var(--primary))] text-[10px] font-semibold text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-sm)]">
          {initial}
        </span>
      </span>
      {!collapsed && (
        <span className="grid min-w-0 flex-1">
          <strong className="truncate text-[13px] text-[hsl(var(--foreground))]">
            {displayName}
          </strong>
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

/**
 * PinHarness source theme affordance, kept in the persistent sidebar footer.
 * Two explicit targets preserve the keyboard/automation contract while the
 * visual treatment stays the source's quiet icon-button language.
 */
function ThemeControls({
  preference,
  setPreference,
  collapsed,
}: {
  preference: 'light' | 'dark' | 'system';
  setPreference: (preference: 'light' | 'dark' | 'system') => void;
  collapsed: boolean;
}) {
  const buttonClass = `grid place-items-center rounded-[8px] text-[hsl(var(--foreground-subtle))] transition-[background-color,border-color,color,transform] duration-[var(--motion-fast)] hover:-translate-y-px hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60 ${collapsed ? 'h-8 w-8' : 'h-7 w-7'}`;
  return (
    <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'gap-0.5'}`}>
      <button
        type="button"
        className={`${buttonClass} ${preference === 'light' ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]' : ''}`}
        onClick={() => setPreference('light')}
        aria-label="浅色主题"
        title="浅色主题"
      >
        <Sun aria-hidden size={16} weight="regular" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${preference === 'dark' ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]' : ''}`}
        onClick={() => setPreference('dark')}
        aria-label="深色主题"
        title="深色主题"
      >
        <Moon aria-hidden size={16} weight="regular" />
      </button>
    </div>
  );
}

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [connection, setConnection] = useState<'连接中' | '已连接' | '已断开'>('已断开');
  const location = useLocation();
  const navigate = useNavigate();
  const authUser = useAuthUser();
  const { preference, setPreference, sidebarCollapsed, sidebarPreference, setSidebarCollapsed } =
    useAgentHubTheme();
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === 'undefined' ? AUTO_COLLAPSE_BREAKPOINT : window.innerWidth,
  );

  useEffect(() => {
    const syncWidth = () => setViewportWidth(window.innerWidth);
    syncWidth();
    window.addEventListener('resize', syncWidth);
    return () => window.removeEventListener('resize', syncWidth);
  }, []);

  const mobile = viewportWidth > 0 && viewportWidth < MOBILE_NAV_BREAKPOINT;
  const forceCollapsed =
    viewportWidth >= MOBILE_NAV_BREAKPOINT && viewportWidth < AUTO_COLLAPSE_BREAKPOINT;
  const collapsed = mobile ? false : sidebarCollapsed || forceCollapsed;

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
      data-sidebar-state={collapsed ? 'collapsed' : 'expanded'}
    >
      <a
        className="fixed left-3 top-3 z-[3000] -translate-y-24 rounded-[var(--radius)] bg-[hsl(var(--foreground))] px-3 py-2 text-xs font-semibold text-[hsl(var(--surface))] shadow-[var(--shadow-lg)] transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!mobile && (
          <aside
            className={`app-sidebar relative h-full shrink-0 flex-col border-r border-[hsl(var(--sidebar-border))]/80 transition-[width,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] flex ${collapsed ? 'w-[var(--sidebar-collapsed-width)]' : 'w-[var(--sidebar-width)]'}`}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[hsl(var(--surface))]/70" />
            <Brand
              collapsed={collapsed}
              onToggle={() => {
                if (!forceCollapsed && sidebarPreference === 'remember')
                  setSidebarCollapsed(!sidebarCollapsed);
              }}
              toggleDisabled={forceCollapsed || sidebarPreference !== 'remember'}
            />
            <button
              type="button"
              className={`mx-2 mt-1 flex min-h-9 items-center gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface))]/60 px-2.5 text-left text-[12px] text-[hsl(var(--foreground-faint))] shadow-[var(--shadow-sm)] transition-[background-color,border-color,color] duration-[var(--motion-fast)] hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/50 ${collapsed ? 'h-[var(--sidebar-control-size)] w-[var(--sidebar-control-size)] justify-center px-0' : ''}`}
              onClick={openCommand}
              aria-label="搜索与跳转"
              title="搜索与跳转"
            >
              <Search aria-hidden size={15} />
              {!collapsed ? <span className="min-w-0 flex-1 truncate">搜索与跳转</span> : null}
              {!collapsed ? (
                <kbd className="rounded-[5px] bg-[hsl(var(--surface-muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--foreground-faint))]">
                  ⌘ K
                </kbd>
              ) : null}
            </button>
            <Navigation collapsed={collapsed} />
            <div
              className={`mt-1.5 border-t border-[hsl(var(--sidebar-border))]/60 py-2.5 ${collapsed ? 'flex flex-col items-center px-2' : 'px-3 2xl:px-4'}`}
            >
              <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'}`}>
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
                {!collapsed && (
                  <span className="ml-auto text-[11px] text-[hsl(var(--foreground-faint))]">
                    实时连接
                  </span>
                )}
              </div>
            </div>
            <div
              className={`border-t border-[hsl(var(--sidebar-border))]/60 p-2.5 ${collapsed ? 'px-2' : 'px-3 2xl:px-4'}`}
            >
              <div className={`flex items-center ${collapsed ? 'flex-col gap-1.5' : 'gap-2'}`}>
                <div className="min-w-0 flex-1">
                  <ProfileSurface collapsed={collapsed} username={authUser?.username} />
                </div>
                <ThemeControls
                  preference={preference}
                  setPreference={setPreference}
                  collapsed={collapsed}
                />
              </div>
            </div>
          </aside>
        )}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {mobile && (
            <header
              className="mobile-app-bar relative z-30 flex shrink-0 items-center justify-between px-4 md:hidden"
              data-shell-topbar="true"
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="mobile-touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[hsl(var(--foreground))] transition-colors active:bg-[hsl(var(--surface))]"
                aria-label="打开导航"
              >
                <Menu aria-hidden size={20} />
              </button>
              <div className="pointer-events-none absolute inset-x-14 flex items-center justify-center">
                <p className="truncate text-[16px] font-semibold text-[hsl(var(--foreground))]">
                  AgentHub
                </p>
                {connection !== '已连接' && (
                  <span
                    role="status"
                    aria-label={connection}
                    title={connection}
                    className="ml-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--warning))]"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={openCommand}
                className="mobile-touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[hsl(var(--foreground-muted))] transition-colors active:bg-[hsl(var(--surface))]"
                aria-label="搜索与跳转"
              >
                <Search aria-hidden size={18} />
              </button>
            </header>
          )}
          <main
            id="main-content"
            className="ambient-canvas app-main min-h-0 flex-1 overflow-y-auto outline-none"
            tabIndex={-1}
          >
            <div key={location.pathname} className="route-stage h-full min-h-0">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <MobileDrawerPanel open={drawerOpen} onClose={() => setDrawerOpen(false)} ariaLabel="导航">
        <Brand />
        <Navigation onNavigate={() => setDrawerOpen(false)} />
        <ProfileSurface username={authUser?.username} />
      </MobileDrawerPanel>

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
