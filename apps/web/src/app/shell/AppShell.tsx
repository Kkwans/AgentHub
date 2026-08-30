import {
  Activity,
  AhButton,
  AhDialog,
  AhDrawer,
  AhInput,
  AhStatusPill,
  ArrowRight,
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
import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { realtime } from '../../lib/realtime';
import { AgentHubLogo } from '../../components/AgentHubLogo';
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

const commandItems: NavigationItem[] = [
  ...primaryNavigation,
  ...secondaryNavigation,
  {
    to: '/workspace',
    label: '最近工作区',
    description: '恢复最近的 Coding Session',
    icon: Activity,
  },
  {
    to: '/agents/diagnostics',
    label: '监控中心',
    description: '查看服务能力与运行诊断',
    icon: Activity,
  },
  {
    to: '/projects/new',
    label: '新建项目',
    description: '从允许目录创建 Project',
    icon: FolderKanban,
  },
  {
    to: '/agents/agents/discover',
    label: '发现 Agent',
    description: '扫描并接入可用 Agent',
    icon: Bot,
  },
];

function Brand() {
  return (
    <div className={styles.brandRow}>
      <div className={styles.brand}>
        <AgentHubLogo className={styles.brandMark} />
        <span className={styles.brandName}>AgentHub</span>
        <span className={styles.version}>v0.9</span>
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
      <nav className={`${styles.navigation} ${styles.secondaryNavigation}`} aria-label="辅助导航">
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
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [connection, setConnection] = useState<'连接中' | '已连接' | '已断开'>('已断开');
  const searchRef = useRef<HTMLInputElement>(null);
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
  }, [setSidebarCollapsed, sidebarCollapsed, sidebarPreference]);

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? commandItems.filter((item) =>
          `${item.label} ${item.description}`.toLocaleLowerCase().includes(normalized),
        )
      : commandItems;
  }, [query]);

  useEffect(() => setActiveIndex(0), [query, commandOpen]);

  function openCommand() {
    setQuery('');
    setCommandOpen(true);
  }

  function goTo(item: NavigationItem) {
    navigate(item.to);
    setCommandOpen(false);
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const item = results[activeIndex];
    if (item) goTo(item);
  }

  return (
    <div className={`${styles.frame}${sidebarCollapsed ? ` ${styles.sidebarCollapsed}` : ''}`}>
      <a className={styles.skipLink} href="#main-content">
        跳到主要内容
      </a>
      <aside className={styles.sidebar}>
        <Brand />
        <Navigation />
        <div className={styles.sidebarFoot}>
          <AhStatusPill
            status={
              connection === '已连接' ? 'ONLINE' : connection === '连接中' ? 'PENDING' : 'OFFLINE'
            }
            label={connection}
          />
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
        <header className={styles.topbar}>
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

      <AhDialog
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        title="搜索与跳转"
        description="查找 Project、Work、Session、Agent 或设置。"
        size={620}
      >
        <form onSubmit={submitCommand}>
          <AhInput
            ref={searchRef}
            label="搜索"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="例如：Prompt、Runtime 或设置"
            autoFocus
            role="combobox"
            aria-expanded={commandOpen}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((value) => (value + 1) % Math.max(1, results.length));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex(
                  (value) => (value - 1 + results.length) % Math.max(1, results.length),
                );
              }
            }}
          />
        </form>
        <div className={styles.commandResults} role="listbox" aria-label="搜索结果">
          {results.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={`${item.to}-${item.label}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.commandResult}${index === activeIndex ? ` ${styles.commandResultActive}` : ''}`}
                onClick={() => goTo(item)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <Icon size={18} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            );
          })}
          {!results.length ? <p className={styles.commandEmpty}>没有匹配结果</p> : null}
        </div>
      </AhDialog>
    </div>
  );
}
