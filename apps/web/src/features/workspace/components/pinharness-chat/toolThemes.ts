/**
 * 工具调用主题色 — 共享模块
 *
 * 为每种工具类型定义一组一致的色彩 Token：
 * - 浅色模式使用柔和的 50/100 底色 + 饱和文字色
 * - 深色模式通过 dark: 前缀补充覆盖
 *
 * 由 ToolUseEntry 和 SubagentEntry 共享消费。
 */

import { Bot, ClipboardList, Eye, FileEdit, Globe, Search, Terminal, Wrench } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

export type ToolThemeKey =
  'terminal' | 'read' | 'edit' | 'search' | 'fetch' | 'agent' | 'plan' | 'default';

export interface ToolTheme {
  headerColor: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  iconColor: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  dotColor: string;
}

export const TOOL_THEMES: Record<ToolThemeKey, ToolTheme> = {
  terminal: {
    headerColor: 'text-zinc-500 dark:text-zinc-400',
    badgeBg: 'bg-zinc-100 dark:bg-zinc-800',
    badgeText: 'text-zinc-600 dark:text-zinc-300',
    badgeBorder: 'border-l-zinc-400 dark:border-l-zinc-500',
    iconColor: 'text-zinc-500 dark:text-zinc-400',
    Icon: Terminal,
    dotColor: 'bg-zinc-400',
  },
  read: {
    headerColor: 'text-sky-600 dark:text-sky-400',
    badgeBg: 'bg-sky-50 dark:bg-sky-950/40',
    badgeText: 'text-sky-700 dark:text-sky-300',
    badgeBorder: 'border-l-sky-400 dark:border-l-sky-500',
    iconColor: 'text-sky-500 dark:text-sky-400',
    Icon: Eye,
    dotColor: 'bg-sky-400',
  },
  edit: {
    headerColor: 'text-amber-600 dark:text-amber-400',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/40',
    badgeText: 'text-amber-700 dark:text-amber-300',
    badgeBorder: 'border-l-amber-400 dark:border-l-amber-500',
    iconColor: 'text-amber-500 dark:text-amber-400',
    Icon: FileEdit,
    dotColor: 'bg-amber-400',
  },
  search: {
    headerColor: 'text-violet-600 dark:text-violet-400',
    badgeBg: 'bg-violet-50 dark:bg-violet-950/40',
    badgeText: 'text-violet-700 dark:text-violet-300',
    badgeBorder: 'border-l-violet-400 dark:border-l-violet-500',
    iconColor: 'text-violet-500 dark:text-violet-400',
    Icon: Search,
    dotColor: 'bg-violet-400',
  },
  fetch: {
    headerColor: 'text-cyan-600 dark:text-cyan-400',
    badgeBg: 'bg-cyan-50 dark:bg-cyan-950/40',
    badgeText: 'text-cyan-700 dark:text-cyan-300',
    badgeBorder: 'border-l-cyan-400 dark:border-l-cyan-500',
    iconColor: 'text-cyan-500 dark:text-cyan-400',
    Icon: Globe,
    dotColor: 'bg-cyan-400',
  },
  agent: {
    headerColor: 'text-emerald-600 dark:text-emerald-400',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
    badgeBorder: 'border-l-emerald-400 dark:border-l-emerald-500',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    Icon: Bot,
    dotColor: 'bg-emerald-400',
  },
  plan: {
    headerColor: 'text-indigo-600 dark:text-indigo-400',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-950/40',
    badgeText: 'text-indigo-700 dark:text-indigo-300',
    badgeBorder: 'border-l-indigo-400 dark:border-l-indigo-500',
    iconColor: 'text-indigo-500 dark:text-indigo-400',
    Icon: ClipboardList,
    dotColor: 'bg-indigo-400',
  },
  default: {
    headerColor: 'text-[hsl(var(--foreground-subtle))]',
    badgeBg: 'bg-[hsl(var(--surface-muted))]',
    badgeText: 'text-[hsl(var(--foreground-muted))]',
    badgeBorder: 'border-l-[hsl(var(--border-strong))]',
    iconColor: 'text-[hsl(var(--foreground-muted))]',
    Icon: Wrench,
    dotColor: 'bg-[hsl(var(--foreground-faint))]',
  },
};

export function resolveToolTheme(name: string): ToolThemeKey {
  const n = name.toLowerCase();
  if (
    n.includes('terminal') ||
    n.includes('bash') ||
    n === 'shell' ||
    n.includes('execute') ||
    n.includes('run_terminal') ||
    n.includes('终端') ||
    n.includes('运行命令')
  )
    return 'terminal';
  if (
    n.includes('read') ||
    n.includes('list_dir') ||
    n === 'glob' ||
    n.includes('glob_file') ||
    n.includes('读取') ||
    n.includes('列出文件')
  )
    return 'read';
  if (
    n.includes('edit') ||
    n.includes('write') ||
    n.includes('replace') ||
    n.includes('multiedit') ||
    n.includes('string_replace') ||
    n.includes('修改') ||
    n.includes('写入')
  )
    return 'edit';
  if (
    n.includes('grep') ||
    n.includes('search') ||
    n.includes('codebase_search') ||
    n.includes('搜索')
  )
    return 'search';
  if (n.includes('fetch') || n.includes('http') || n.includes('web_') || n.includes('网页'))
    return 'fetch';
  if (n.includes('agent') || n.includes('task') || n.includes('子 agent')) return 'agent';
  if (n.includes('plan') || n.includes('todo') || n.includes('计划')) return 'plan';
  return 'default';
}
