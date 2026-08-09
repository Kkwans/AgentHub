import { useEffect, useState } from 'react';
import {
  Bot,
  Braces,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { realtime } from '../lib/realtime';

const navigation = [
  { to: '/overview', label: '概览', icon: LayoutDashboard },
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/tasks', label: '任务', icon: ListTodo },
  { to: '/agents', label: 'Agent', icon: Bot },
  { to: '/sessions', label: '会话', icon: MessageSquare },
  { to: '/promptos', label: 'PromptOS', icon: Braces },
  { to: '/settings', label: '设置', icon: Settings },
];

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<'连接中' | '已连接' | '已断开'>('已断开');
  const location = useLocation();
  useEffect(() => realtime.onState(setConnection), []);
  useEffect(() => setOpen(false), [location.pathname]);
  const title =
    navigation.find((item) => location.pathname.startsWith(item.to))?.label ?? 'AgentHub';

  return (
    <div className="app-frame">
      <button className="mobile-menu" onClick={() => setOpen(true)} aria-label="打开导航">
        <Menu size={20} />
      </button>
      {open && (
        <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setOpen(false)} />
      )}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark">AH</div>
          <div>
            <strong>AgentHub</strong>
            <span>工程控制平面</span>
          </div>
          <button className="sidebar-close" onClick={() => setOpen(false)} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>
        <nav className="main-nav" aria-label="一级导航">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="environment-label">本地环境</div>
          <div className="environment-row">
            <span className={`connection-dot ${connection === '已连接' ? 'online' : ''}`} />
            <span>{connection}</span>
            <code>v0.1</code>
          </div>
        </div>
      </aside>
      <div className="app-column">
        <header className="topbar">
          <div>
            <span className="eyebrow">AGENTHUB / {title}</span>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={16} />
              <input aria-label="全局搜索" placeholder="搜索 Project、Session 或 Agent" />
              <kbd>⌘ K</kbd>
            </label>
            <span className={`connection-pill ${connection === '已连接' ? 'online' : ''}`}>
              <span /> {connection}
            </span>
          </div>
        </header>
        <main className="page-body">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
