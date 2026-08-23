import {
  AhButton,
  AhDialog,
  AhDrawer,
  AhInput,
  AhStatusPill,
  ArrowRight,
  Bot,
  Braces,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  Wrench,
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
};

const navigation: NavigationItem[] = [
  { to: '/home', label: '首页', description: '关注事项与最近工作', icon: LayoutDashboard },
  { to: '/projects', label: '项目', description: '工程上下文与工作入口', icon: FolderKanban },
  { to: '/agents/agents', label: 'Agent', description: 'Agent 身份与可用性', icon: Bot },
  { to: '/prompts', label: 'Prompt Library', description: '可复用的 Prompt 资产', icon: Braces },
  { to: '/settings/appearance', label: '设置', description: '外观、账号与系统设置', icon: Settings },
];

const commandItems: NavigationItem[] = [
  ...navigation,
  { to: '/projects', label: '新建项目', description: '从允许目录创建 Project', icon: FolderKanban },
  { to: '/agents/agents', label: '发现 Agent', description: '扫描并接入可用 Agent', icon: Bot },
  { to: '/settings/appearance', label: '切换主题', description: '浅色、深色或跟随系统', icon: Wrench },
];

function Brand() {
  return (
    <div className={styles.brand}>
      <AgentHubLogo className={styles.brandMark} />
      <div>
        <strong>AgentHub</strong>
        <span>AI Engineering Workbench</span>
      </div>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className={styles.navigation} aria-label="主导航">
      <span className={styles.navLabel}>工作台</span>
      {navigation.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/home' || to === '/projects'}
          className={({ isActive }) => `${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ''}`}
          onClick={onNavigate}
        >
          <span className={styles.navIcon}><Icon aria-hidden size={18} weight="regular" /></span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function titleForPath(pathname: string): string {
  if (pathname.startsWith('/projects/')) return '项目工作台';
  if (pathname.startsWith('/agents/')) return 'Agent 基础设施';
  if (pathname.startsWith('/workspace/')) return 'Coding Workspace';
  if (pathname.startsWith('/settings/')) return '设置';
  if (pathname.startsWith('/prompts')) return 'Prompt Library';
  return navigation.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))?.label ?? '首页';
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

  useEffect(() => realtime.onState(setConnection), []);
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? commandItems.filter((item) => `${item.label} ${item.description}`.toLocaleLowerCase().includes(normalized))
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
    <div className={styles.frame}>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>
      <aside className={styles.sidebar}>
        <Brand />
        <Navigation />
        <div className={styles.sidebarFoot}>
          <AhStatusPill status={connection === '已连接' ? 'ONLINE' : connection === '连接中' ? 'PENDING' : 'OFFLINE'} label={connection} />
          <span>本地工作台</span>
        </div>
      </aside>
      <div className={styles.column}>
        <header className={styles.topbar}>
          <div className={styles.titleBlock}>
            <AhButton className={styles.mobileMenu} variant="subtle" color="gray" onClick={() => setDrawerOpen(true)} aria-label="打开导航">
              <Menu size={20} />
            </AhButton>
            <div>
              <span className={styles.eyebrow}>AGENTHUB / WORKBENCH</span>
              <h1>{titleForPath(location.pathname)}</h1>
            </div>
          </div>
          <div className={styles.topbarActions}>
            <AhButton variant="default" color="gray" className={styles.commandTrigger} onClick={openCommand} leftSection={<Search size={16} />}>
              搜索与跳转 <kbd>⌘ K</kbd>
            </AhButton>
            <AhStatusPill status={connection === '已连接' ? 'ONLINE' : connection === '连接中' ? 'PENDING' : 'OFFLINE'} label={connection} />
          </div>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <AhDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="AgentHub" position="left">
        <Brand />
        <Navigation onNavigate={() => setDrawerOpen(false)} />
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
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => (value + 1) % Math.max(1, results.length)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => (value - 1 + results.length) % Math.max(1, results.length)); }
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
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
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
