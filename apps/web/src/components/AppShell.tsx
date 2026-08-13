import { type ComponentType, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Bot,
  Braces,
  Dialog,
  Flex,
  FolderKanban,
  IconButton,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  Search,
  Settings,
  Text,
  TextField,
  X,
  type IconProps,
} from '@agenthub/ui';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { realtime } from '../lib/realtime';
import { AgentHubLogo } from './AgentHubLogo';

type NavigationItem = {
  to: string;
  label: string;
  description: string;
  icon: ComponentType<IconProps>;
};

const navigation: NavigationItem[] = [
  { to: '/overview', label: '概览', description: '运行状态与待处理事项', icon: LayoutDashboard },
  { to: '/projects', label: '项目', description: '已接入的工程工作区', icon: FolderKanban },
  { to: '/tasks', label: '任务', description: 'Goal、Task 与 Worktree', icon: ListTodo },
  { to: '/agents', label: 'Agent', description: 'Agent 与执行目标', icon: Bot },
  { to: '/sessions', label: '会话', description: '会话与运行记录', icon: MessageSquare },
  { to: '/promptos', label: 'PromptOS', description: 'Prompt、版本与绑定', icon: Braces },
  { to: '/settings', label: '设置', description: '安全、能力与诊断', icon: Settings },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="main-nav" aria-label="一级导航">
      {navigation.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
          onClick={onNavigate}
        >
          <Icon aria-hidden size={18} weight="regular" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="brand-block">
      <AgentHubLogo className="brand-mark" />
      <div className="brand-copy">
        <strong>AgentHub</strong>
        <span>工程控制平面</span>
      </div>
    </div>
  );
}

export function AppShell() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeResult, setActiveResult] = useState(0);
  const [connection, setConnection] = useState<'连接中' | '已连接' | '已断开'>('已断开');
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => realtime.onState(setConnection), []);
  useEffect(() => setNavigationOpen(false), [location.pathname]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const title =
    navigation.find((item) => location.pathname.startsWith(item.to))?.label ?? 'AgentHub';
  const activeItem = navigation.find((item) => location.pathname.startsWith(item.to));
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return navigation;
    return navigation.filter((item) =>
      `${item.label} ${item.description}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query]);
  const commandShortcut =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘ K'
      : 'Ctrl K';

  useEffect(() => setActiveResult(0), [query, commandOpen]);

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
    if (results[activeResult]) goTo(results[activeResult]);
  }

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Brand />
        <Navigation />
        <div className="sidebar-foot">
          <div className="environment-row">
            <Badge
              aria-hidden="true"
              color={connection === '已连接' ? 'green' : 'gray'}
              variant="soft"
            >
              {connection}
            </Badge>
            <Text as="span" color="gray" size="1">
              LOCAL
            </Text>
          </div>
        </div>
      </aside>
      <div className="app-column">
        <header className="topbar">
          <Flex align="center" gap="3" minWidth="0">
            <IconButton
              className="mobile-menu"
              color="gray"
              variant="ghost"
              onClick={() => setNavigationOpen(true)}
              aria-label="打开导航"
            >
              <Menu size={21} />
            </IconButton>
            <Box minWidth="0">
              <span className="eyebrow">AGENTHUB</span>
              <h1>{title}</h1>
            </Box>
          </Flex>
          <div className="topbar-actions">
            <button
              aria-label="搜索与跳转"
              className="command-trigger"
              type="button"
              onClick={openCommand}
            >
              <Search aria-hidden size={16} />
              <span>搜索与跳转</span>
              <kbd>{commandShortcut}</kbd>
            </button>
            <Badge
              className={`connection-pill${connection === '已连接' ? ' online' : ''}`}
              color={
                connection === '已连接' ? 'green' : connection === '连接中' ? 'orange' : 'gray'
              }
              variant="soft"
              role="status"
              aria-live="polite"
              aria-label={`实时连接${connection}`}
            >
              {connection}
            </Badge>
          </div>
        </header>
        <main className="page-body" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
        <Dialog.Content className="mobile-navigation" aria-describedby={undefined}>
          <Dialog.Title className="visually-hidden">主导航</Dialog.Title>
          <Flex align="center" justify="between">
            <Brand />
            <Dialog.Close>
              <IconButton color="gray" variant="ghost" aria-label="关闭导航">
                <X size={20} />
              </IconButton>
            </Dialog.Close>
          </Flex>
          <Navigation onNavigate={() => setNavigationOpen(false)} />
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={commandOpen} onOpenChange={setCommandOpen}>
        <Dialog.Content
          className="command-dialog"
          aria-describedby="command-description"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <Dialog.Title>搜索与跳转</Dialog.Title>
          <Dialog.Description id="command-description">
            输入页面名称，按 Enter 立即打开。
          </Dialog.Description>
          <form className="command-form" onSubmit={submitCommand}>
            <TextField.Root
              ref={searchRef}
              size="3"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：Agent、PromptOS 或设置"
              aria-label="搜索页面"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={commandOpen}
              aria-controls="command-results"
              aria-activedescendant={
                results[activeResult] ? `command-option-${activeResult}` : undefined
              }
              onKeyDown={(event) => {
                if (!results.length) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveResult((current) => (current + 1) % results.length);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveResult((current) => (current - 1 + results.length) % results.length);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  setActiveResult(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  setActiveResult(results.length - 1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (results[activeResult]) goTo(results[activeResult]);
                }
              }}
            >
              <TextField.Slot>
                <Search size={18} />
              </TextField.Slot>
            </TextField.Root>
          </form>
          <div
            className="command-results"
            id="command-results"
            role="listbox"
            aria-label="页面搜索结果"
          >
            {results.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.to}
                  id={`command-option-${index}`}
                  className="command-result"
                  type="button"
                  role="option"
                  aria-selected={index === activeResult}
                  onMouseMove={() => setActiveResult(index)}
                  onFocus={() => setActiveResult(index)}
                  onClick={() => goTo(item)}
                >
                  <span className="command-result-icon">
                    <Icon size={19} />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <kbd>{index === activeResult ? '↵' : ''}</kbd>
                </button>
              );
            })}
            {results.length === 0 && (
              <Text className="command-empty" color="gray" size="2">
                没有匹配的页面
              </Text>
            )}
          </div>
          <div className="command-foot">
            <span>{activeItem?.description}</span>
            <span>Esc 关闭</span>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
