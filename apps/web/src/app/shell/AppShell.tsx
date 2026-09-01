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
  Network,
  Search,
  Settings,
  Sun,
  useAgentHubTheme,
  type IconProps,
} from '@agenthub/ui';
import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { realtime } from '../../lib/realtime';
import { AgentHubLogo } from '../../components/AgentHubLogo';
import { CommandPalette } from './CommandPalette';
import styles from './AppShell.module.css';

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

function Brand() {
  return (
    <div className={styles.brandRow}>
      <div className={styles.brand}>
        <AgentHubLogo className={styles.brandMark} />
        <span className={styles.brandName}>AgentHub</span>
        <span className={styles.version}>v1.0</span>
      </div>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className={styles.navigationStack}>
      <nav className={`${styles.navigation} ${styles.primaryNavigation}`} aria-label="主导航">
        {primaryNavigation.map(({ to, label, icon: Icon, shortcut }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/home' || to === '/projects'}
            className={({ isActive }) =>
              `${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ''}`
            }
            onClick={onNavigate}
            aria-label={label}
          >
            <span className={styles.navIcon}>
              <Icon aria-hidden size={18} weight="regular" />
            </span>
            <span className={styles.navText}>{label}</span>
            {shortcut ? <span className={styles.navKey}>{shortcut}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className={styles.navDivider} aria-hidden="true" />
      <div className={styles.secondaryNavigationGroup}>
        <span className={styles.navSectionLabel}>Infrastructure</span>
        <nav
          className={`${styles.navigation} ${styles.secondaryNavigation}`}
          aria-label="Infrastructure"
        >
          {secondaryNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ''}`
              }
              onClick={onNavigate}
              aria-label={label}
            >
              <span className={styles.navIcon}>
                <Icon aria-hidden size={18} weight="regular" />
              </span>
              <span className={styles.navText}>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function ProfileSurface() {
  return (
    <button type="button" className={styles.profileCard} aria-label="Kwan，管理员账户">
      <span className={styles.profileAvatar}>K</span>
      <span className={styles.profileCopy}>
        <strong>Kwan</strong>
        <small>Admin</small>
      </span>
      <ChevronRight className={styles.profileChevron} aria-hidden size={15} />
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
    // Prime the primary Project route after the shell has painted so the first
    // navigation does not pay the lazy chunk parse cost on the critical click.
    const timer = window.setTimeout(() => {
      void import('../../features/projects/pages/ProjectsPage');
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);
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
      className={`${styles.frame}${sidebarCollapsed ? ` ${styles.sidebarCollapsed}` : ''}`}
      data-shell="app-shell"
      data-sidebar-state={sidebarCollapsed ? 'collapsed' : 'expanded'}
    >
      <a className={styles.skipLink} href="#main-content">
        跳到主要内容
      </a>
      <aside className={styles.sidebar}>
        <Brand />
        <Navigation />
        <div className={styles.sidebarFoot}>
          <div
            className={styles.connectionStatus}
            role="status"
            aria-label={`实时连接${connection}`}
          >
            <AhStatusPill
              status={
                connection === '已连接' ? 'ONLINE' : connection === '连接中' ? 'PENDING' : 'OFFLINE'
              }
              label={connection}
            />
          </div>
          <span>实时连接</span>
        </div>
        <button
          type="button"
          className={styles.sidebarCollapse}
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
          <span>{sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}</span>
          <kbd>⌘ B</kbd>
        </button>
        <ProfileSurface />
      </aside>
      <div className={styles.column}>
        <header className={styles.topbar} data-shell-topbar="true">
          <div className={styles.menuControls}>
            <AhButton
              className={styles.mobileMenu}
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
            className={styles.globalSearch}
            onClick={openCommand}
            aria-label="搜索与跳转"
          >
            <Search aria-hidden size={16} />
            <span>搜索项目 / Agent / Prompt...</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className={styles.topbarActions}>
            <button
              type="button"
              className={`${styles.iconButton}${preference === 'light' ? ` ${styles.iconButtonActive}` : ''}`}
              onClick={() => setPreference('light')}
              aria-label="浅色主题"
              title="浅色主题"
            >
              <Sun aria-hidden size={18} weight="regular" />
            </button>
            <button
              type="button"
              className={`${styles.iconButton}${preference === 'dark' ? ` ${styles.iconButtonActive}` : ''}`}
              onClick={() => setPreference('dark')}
              aria-label="深色主题"
              title="深色主题"
            >
              <span className={styles.themeGlyph} aria-hidden="true">
                ◐
              </span>
            </button>
            <button type="button" className={styles.iconButton} aria-label="通知" title="通知">
              <Bell aria-hidden size={18} />
            </button>
          </div>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
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

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onNavigate={(href) => navigate(href)}
        {...(contextProjectId ? { contextProjectId } : {})}
      />
    </div>
  );
}
