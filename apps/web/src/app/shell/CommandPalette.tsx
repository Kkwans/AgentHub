import {
  Activity,
  ArrowRight,
  Bot,
  Braces,
  CubeIcon,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Network,
  Plus,
  Settings,
  AhDialog,
  AhInput,
  type IconProps,
} from '@agenthub/ui';
import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react';

import styles from './AppShell.module.css';

export type PaletteGroup = 'Recent' | 'Projects' | 'Sessions' | 'Agents' | 'Prompts' | 'Commands';

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  description: string;
  href: string;
  icon: ComponentType<IconProps>;
  keywords?: readonly string[];
  meta?: string;
  recentAt?: number;
  recentOf?: string;
};

export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  'Recent',
  'Projects',
  'Sessions',
  'Agents',
  'Prompts',
  'Commands',
];

const RECENT_STORAGE_KEY = 'agenthub.command.recent';
const MAX_RECENT_ITEMS = 8;

type StoredRecentItem = { id: string; visitedAt: number };

function readRecentItems(): StoredRecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is StoredRecentItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StoredRecentItem).id === 'string' &&
        typeof (item as StoredRecentItem).visitedAt === 'number',
    );
  } catch {
    return [];
  }
}

function rememberItem(item: PaletteItem): void {
  if (typeof window === 'undefined') return;
  const next = [
    { id: item.recentOf ?? item.id, visitedAt: Date.now() },
    ...readRecentItems().filter((entry) => entry.id !== (item.recentOf ?? item.id)),
  ].slice(0, MAX_RECENT_ITEMS);
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
}

/**
 * Scores a query against a label/description using a small subsequence matcher.
 * Contiguous and word-start matches rank above a loose fuzzy match, while a
 * non-match returns -1 so the palette can keep filtering deterministic.
 */
export function fuzzyScore(query: string, text: string): number {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  if (!needle) return 0;
  if (haystack === needle) return 10_000;
  const exactIndex = haystack.indexOf(needle);
  if (exactIndex >= 0) return 8_000 - exactIndex * 4 - (haystack.length - needle.length);

  let cursor = 0;
  let score = 0;
  let previousIndex = -1;
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return -1;
    const contiguous = previousIndex >= 0 && index === previousIndex + 1;
    const wordStart = index === 0 || /[\s/_-]/.test(haystack[index - 1] ?? '');
    score += contiguous ? 24 : 8;
    score += wordStart ? 12 : 0;
    previousIndex = index;
    cursor = index + 1;
  }
  return score - haystack.length;
}

function defaultItems(contextProjectId?: string): PaletteItem[] {
  const projectItems: PaletteItem[] = [
    {
      id: 'projects:list',
      group: 'Projects',
      label: '项目',
      description: '查看全部 Project',
      href: '/projects',
      icon: FolderKanban,
      keywords: ['project', '工程', '列表'],
    },
    {
      id: 'projects:new',
      group: 'Projects',
      label: '新建项目',
      description: '从允许目录创建 Project',
      href: '/projects/new',
      icon: Plus,
      keywords: ['new', 'create', 'project'],
    },
  ];
  if (contextProjectId) {
    projectItems.push({
      id: `projects:${contextProjectId}:work:new`,
      group: 'Projects',
      label: '新建 Work',
      description: '在当前 Project 中创建 Work',
      href: `/projects/${contextProjectId}/work/new`,
      icon: Plus,
      keywords: ['new work', 'task', 'project'],
    });
  }

  return [
    {
      id: 'home',
      group: 'Recent',
      label: '首页',
      description: '关注事项与最近工作',
      href: '/home',
      icon: LayoutDashboard,
      keywords: ['home', 'dashboard', 'overview'],
    },
    {
      id: 'workspace:recent',
      group: 'Recent',
      label: '最近工作区',
      description: '恢复最近的 Coding Session',
      href: '/workspace',
      icon: Activity,
      keywords: ['workspace', 'session', 'recent'],
    },
    ...projectItems,
    {
      id: 'sessions:recent',
      group: 'Sessions',
      label: 'Session 列表',
      description: '按 Project 查看会话与运行记录',
      href: '/projects',
      icon: MessageSquare,
      keywords: ['session', 'conversation', 'run'],
    },
    {
      id: 'agents:list',
      group: 'Agents',
      label: 'Agent 中心',
      description: '查看 Agent 身份与可用性',
      href: '/agents',
      icon: Bot,
      keywords: ['agent', 'identity', 'ready'],
    },
    {
      id: 'agents:runtime',
      group: 'Agents',
      label: '运行环境',
      description: 'Local、Docker 与远程执行环境',
      href: '/agents/runtime',
      icon: CubeIcon,
      keywords: ['runtime', 'infrastructure', 'docker'],
    },
    {
      id: 'agents:nodes',
      group: 'Agents',
      label: '远程节点',
      description: '连接和管理远程 Agent 节点',
      href: '/agents/nodes',
      icon: Network,
      keywords: ['remote', 'node', 'infrastructure'],
    },
    {
      id: 'prompts:list',
      group: 'Prompts',
      label: 'Prompt 库',
      description: '可复用的 Prompt 资产',
      href: '/prompts',
      icon: Braces,
      keywords: ['prompt', 'promptos', 'library'],
    },
    {
      id: 'commands:settings',
      group: 'Commands',
      label: '设置',
      description: '外观、账号与系统设置',
      href: '/settings/appearance',
      icon: Settings,
      keywords: ['settings', 'appearance', 'theme'],
    },
    {
      id: 'commands:discover-agent',
      group: 'Commands',
      label: '发现 Agent',
      description: '扫描并接入可用 Agent',
      href: '/agents/agents/discover',
      icon: Bot,
      keywords: ['discover', 'agent', 'scan'],
    },
  ];
}

function itemSearchText(item: PaletteItem): string {
  return [item.label, item.description, item.href, ...(item.keywords ?? [])].join(' ');
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
  contextProjectId?: string;
  items?: readonly PaletteItem[];
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  contextProjectId,
  items,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentItems, setRecentItems] = useState<StoredRecentItem[]>(readRecentItems);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    setRecentItems(readRecentItems());
  }, [open]);

  const recentById = useMemo(
    () => new Map(recentItems.map((entry) => [entry.id, entry.visitedAt])),
    [recentItems],
  );

  const paletteItems = useMemo(() => {
    const baseItems = items ?? defaultItems(contextProjectId);
    const knownItems = new Map(baseItems.map((item) => [item.id, item]));
    const recentCopies = recentItems
      .map((entry) => knownItems.get(entry.id))
      .filter((item): item is PaletteItem => Boolean(item))
      .filter((item) => item.group !== 'Recent')
      .map((item) => {
        const visitedAt = recentById.get(item.id);
        return {
          ...item,
          id: `recent:${item.id}`,
          group: 'Recent' as const,
          ...(visitedAt === undefined ? {} : { recentAt: visitedAt }),
          recentOf: item.id,
          meta: '最近访问',
        };
      });
    return [...baseItems, ...recentCopies];
  }, [contextProjectId, items, recentById, recentItems]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim();
    return paletteItems
      .map((item, sourceIndex) => ({
        item,
        sourceIndex,
        score: fuzzyScore(normalized, itemSearchText(item)),
      }))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => {
        if (normalized && right.score !== left.score) return right.score - left.score;
        if (left.item.group !== right.item.group) {
          return PALETTE_GROUPS.indexOf(left.item.group) - PALETTE_GROUPS.indexOf(right.item.group);
        }
        const leftRecent = recentById.get(left.item.id) ?? left.item.recentAt ?? 0;
        const rightRecent = recentById.get(right.item.id) ?? right.item.recentAt ?? 0;
        if (left.item.group === 'Recent' && rightRecent !== leftRecent) {
          return rightRecent - leftRecent;
        }
        return left.sourceIndex - right.sourceIndex;
      })
      .map(({ item }) => item);
  }, [paletteItems, query, recentById]);

  const groupedItems = useMemo(() => {
    const groups = new Map<PaletteGroup, PaletteItem[]>();
    for (const group of PALETTE_GROUPS) groups.set(group, []);
    for (const item of visibleItems) groups.get(item.group)?.push(item);
    return groups;
  }, [visibleItems]);

  const flatItems = useMemo(
    () => PALETTE_GROUPS.flatMap((group) => groupedItems.get(group) ?? []),
    [groupedItems],
  );

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  const activeItem = flatItems[activeIndex];

  function goTo(item: PaletteItem | undefined) {
    if (!item) return;
    rememberItem(item);
    setRecentItems(readRecentItems());
    onNavigate(item.href);
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    goTo(activeItem);
  }

  function moveActive(direction: 1 | -1) {
    if (!flatItems.length) return;
    setActiveIndex((current) => (current + direction + flatItems.length) % flatItems.length);
  }

  return (
    <AhDialog
      open={open}
      onClose={onClose}
      title="搜索与跳转"
      description="按名称、路径或关键词搜索；↑↓选择，Enter打开，Esc关闭。"
      size={660}
    >
      <form onSubmit={submit}>
        <AhInput
          ref={searchRef}
          label="搜索"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="例如：Prompt、Runtime 或新建 Work"
          autoFocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="command-results"
          aria-activedescendant={
            activeItem ? `command-option-${flatItems.indexOf(activeItem)}` : undefined
          }
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveActive(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveActive(-1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActiveIndex(Math.max(0, flatItems.length - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              goTo(activeItem);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </form>
      <div
        className={styles.commandResults}
        id="command-results"
        role="listbox"
        aria-label="搜索结果"
      >
        {PALETTE_GROUPS.map((group) => {
          const groupItems = groupedItems.get(group) ?? [];
          if (!groupItems.length && query.trim()) return null;
          return (
            <section className={styles.commandGroup} key={group} aria-label={group}>
              <h3 className={styles.commandGroupLabel}>{group}</h3>
              {groupItems.length ? (
                groupItems.map((item) => {
                  const index = flatItems.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      id={`command-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`${styles.commandResult}${index === activeIndex ? ` ${styles.commandResultActive}` : ''}`}
                      onClick={() => goTo(item)}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span className={styles.commandResultIcon} aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span className={styles.commandResultCopy}>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      {item.meta ? (
                        <small className={styles.commandResultMeta}>{item.meta}</small>
                      ) : null}
                      <ArrowRight className={styles.commandResultArrow} aria-hidden size={15} />
                    </button>
                  );
                })
              ) : (
                <p className={styles.commandGroupEmpty}>暂无可跳转项</p>
              )}
            </section>
          );
        })}
        {!flatItems.length ? <p className={styles.commandEmpty}>没有匹配结果</p> : null}
      </div>
    </AhDialog>
  );
}
