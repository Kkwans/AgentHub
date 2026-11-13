import { AhButton, AhEmptyState, ChevronDown, Search, Tag } from '@agenthub/ui';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useCompactViewport } from '../../shared/page-primitives';
import { labelPromptKind } from '../../../presentation/domain-labels';
import promptSettingsStyles from '../promptSettings.module.css';

import type { PromptLibraryModel } from '../hooks/usePromptLibrary';

export function PromptAssetList({ model }: { model: PromptLibraryModel }) {
  const compact = useCompactViewport();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const directoryId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const directoryRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (compact && !directoryOpen && directoryRef.current?.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
  }, [compact, directoryOpen]);
  const closeDirectory = () => {
    setDirectoryOpen(false);
    toggleRef.current?.focus();
  };
  const {
    searchParams,
    setSearchParams,
    prompts,
    selected,
    setSelectedId,
    filteredPrompts,
    search,
    setSearch,
    promptFilter,
    setPromptFilter,
    promptFilters,
    setTab,
    setNewOpen,
  } = model;

  return (
    <aside className={promptSettingsStyles.libraryPane} aria-label="Prompt 目录">
      <div className={promptSettingsStyles.libraryHeader}>
        <div>
          <strong>Prompt 目录</strong>
          <small>{prompts.data?.length ?? 0} 个资产</small>
        </div>
        {compact ? (
          <button
            type="button"
            ref={toggleRef}
            className={promptSettingsStyles.directoryToggle}
            aria-expanded={directoryOpen}
            aria-controls={directoryId}
            onClick={() => setDirectoryOpen((open) => !open)}
          >
            {directoryOpen ? '收起目录' : '展开目录'}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div
        id={directoryId}
        ref={directoryRef}
        className={promptSettingsStyles.directoryContent}
        hidden={compact && !directoryOpen}
        onKeyDown={(event) => {
          if (compact && event.key === 'Escape') {
            event.stopPropagation();
            closeDirectory();
          }
        }}
      >
        <label className={promptSettingsStyles.searchField}>
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="搜索 Prompt"
            placeholder="搜索 Prompt、标签或项目…"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <div className={promptSettingsStyles.filterRow} role="group" aria-label="Prompt 类型筛选">
          {promptFilters.map((filter) => (
            <button
              type="button"
              key={filter.value}
              className={`${promptSettingsStyles.filterPill} ${promptFilter === filter.value ? promptSettingsStyles.filterPillActive : ''}`}
              aria-pressed={promptFilter === filter.value}
              onClick={() => setPromptFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className={promptSettingsStyles.promptList}>
          {filteredPrompts.map((prompt) => (
            <button
              type="button"
              className={`${promptSettingsStyles.promptListRow} ${prompt.id === selected?.id ? promptSettingsStyles.promptListRowActive : ''}`}
              key={prompt.id}
              onClick={() => {
                setSelectedId(prompt.id);
                setTab('content');
                const next = new URLSearchParams(searchParams);
                next.set('promptId', prompt.id);
                next.delete('tab');
                setSearchParams(next, { replace: true });
                if (compact) closeDirectory();
              }}
            >
              <span className={promptSettingsStyles.promptRowIcon}>
                <Tag size={14} />
              </span>
              <div>
                <strong>{prompt.name}</strong>
                <small>{prompt.key}</small>
              </div>
              <span className={promptSettingsStyles.rowMeta}>{labelPromptKind(prompt.kind)}</span>
            </button>
          ))}
          {!filteredPrompts.length ? (
            <AhEmptyState
              compact
              title={search || promptFilter !== 'all' ? '没有匹配的 Prompt' : '还没有 Prompt'}
              description={
                search || promptFilter !== 'all'
                  ? '尝试调整筛选条件。'
                  : '从真实 PromptOS 资产开始建立模板。'
              }
              action={
                !search && promptFilter === 'all' ? (
                  <AhButton size="sm" onClick={() => setNewOpen(true)}>
                    创建资产
                  </AhButton>
                ) : undefined
              }
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
