/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AhButton,
  AhDialog,
  AhDrawer,
  AhEmptyState,
  AhErrorState,
  AhInput,
  AhLoadingState,
  AhMetric,
  AhReveal,
  AhSelect,
  AhStatusPill,
  AhSurface,
  AhSwitch,
  AhTextarea,
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Copy,
  Eye,
  FolderKanban,
  GitBranch,
  Link2,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  ScanSearch,
  Server,
  SquareTerminal,
  Tag,
  Wrench,
  useAgentHubTheme,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import type {
  AgentCandidateRecord,
  AgentRecord,
  ApiTokenRecord,
  ApprovalRecord,
  DashboardSnapshot,
  EventRecord,
  ExecutionTargetRecord,
  GoalRecord,
  MessageRecord,
  PromptBindingRecord,
  PromptLabelRecord,
  PromptRecord,
  PromptVersionRecord,
  ProjectRecord,
  ResolvedPromptContextRecord,
  RemoteNodeDiagnostics,
  RemoteNodeRecord,
  RemoteNodeRegistration,
  RuntimeCandidateRecord,
  RunRecord,
  SessionConfigurationRecord,
  SessionRecord,
  TaskRecord,
  WorktreeExecutionRecord,
} from '../../../lib/api';
import { api } from '../../../lib/api';
import { realtime } from '../../../lib/realtime';
import {
  labelPromptBindingTarget,
  labelPromptKind,
  labelPromptSelector,
  labelPromptType,
  labelPromptVersionSource,
} from '../../../presentation/domain-labels';
import layout from '../../shared/layout.module.css';
import {
  Screen,
  QueryMessage,
  displayDate,
  useCompactViewport,
  projectLanguage,
  projectTimestamp,
  domainStatusLabel,
  taskStateClass,
  sessionGroupKey,
} from '../../shared/page-primitives';
import promptSettingsStyles from '../promptSettings.module.css';

export function PromptLibraryPage() {
  const client = useQueryClient();
  const routeParams = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = routeParams.projectId ?? searchParams.get('projectId') ?? undefined;
  const promptId = routeParams.promptId ?? searchParams.get('promptId') ?? '';
  type PromptMainTab = 'content' | 'variables' | 'bindings' | 'playground';
  const requestedTab = searchParams.get('tab');
  const initialTab: PromptMainTab =
    requestedTab === 'variables' || requestedTab === 'bindings' || requestedTab === 'playground'
      ? requestedTab
      : 'content';
  const prompts = useQuery({
    queryKey: ['prompts', projectId ?? 'all'],
    queryFn: () =>
      api.get<PromptRecord[]>(projectId ? `/prompts?projectId=${projectId}` : '/prompts'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<TaskRecord[]>('/tasks') });
  const [selectedId, setSelectedId] = useState(promptId ?? '');
  const [tab, setTab] = useState<PromptMainTab>(initialTab);
  const [search, setSearch] = useState('');
  const [promptFilter, setPromptFilter] = useState<'all' | 'SYSTEM' | 'TASK' | 'REVIEW' | 'RULE'>(
    'all',
  );
  const selected = prompts.data?.find((prompt) => prompt.id === selectedId) ?? prompts.data?.[0];
  const filteredPrompts = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (prompts.data ?? []).filter((prompt) => {
      const matchesText =
        !normalized ||
        `${prompt.name} ${prompt.key} ${prompt.description ?? ''}`
          .toLowerCase()
          .includes(normalized);
      const matchesKind = promptFilter === 'all' || prompt.kind === promptFilter;
      return matchesText && matchesKind;
    });
  }, [promptFilter, prompts.data, search]);
  useEffect(() => {
    if (promptId) setSelectedId(promptId);
  }, [promptId]);
  useEffect(() => {
    if (
      requestedTab === 'content' ||
      requestedTab === 'variables' ||
      requestedTab === 'bindings' ||
      requestedTab === 'playground'
    )
      setTab(requestedTab);
  }, [requestedTab]);
  useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.id);
  }, [selected, selectedId]);
  const versions = useQuery({
    queryKey: ['prompt-versions', selected?.id],
    queryFn: () => api.get<PromptVersionRecord[]>(`/prompts/${selected?.id}/versions`),
    enabled: Boolean(selected),
  });
  const labels = useQuery({
    queryKey: ['prompt-labels', selected?.id],
    queryFn: () => api.get<PromptLabelRecord[]>(`/prompts/${selected?.id}/labels`),
    enabled: Boolean(selected),
  });
  const bindings = useQuery({
    queryKey: ['prompt-bindings', selected?.id],
    queryFn: () => api.get<PromptBindingRecord[]>(`/prompt-bindings?promptId=${selected?.id}`),
    enabled: Boolean(selected),
  });
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post<PromptRecord>('/prompts', {
        projectId,
        key: key.trim(),
        name: name.trim(),
        kind: 'TASK',
        type: 'TEXT',
      }),
    onSuccess: (prompt) => {
      void client.invalidateQueries({ queryKey: ['prompts'] });
      setSelectedId(prompt.id);
      setNewOpen(false);
    },
  });
  const [versionOpen, setVersionOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [diffFrom, setDiffFrom] = useState('');
  const [diffTo, setDiffTo] = useState('');
  const [versionContent, setVersionContent] = useState('');
  const [versionVariables, setVersionVariables] = useState('{}');
  const [versionChangelog, setVersionChangelog] = useState('');
  const versionCreate = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('请先选择 Prompt');
      let variables: Record<string, unknown>;
      try {
        variables = JSON.parse(versionVariables || '{}') as Record<string, unknown>;
      } catch {
        throw new Error('Variables 必须是有效 JSON');
      }
      const content =
        selected.type === 'CHAT'
          ? JSON.parse(versionContent || '{"messages":[]}')
          : { text: versionContent };
      return api.post(`/prompts/${selected.id}/versions`, {
        content,
        variables,
        changelog: versionChangelog.trim() || undefined,
      });
    },
    onSuccess: () => {
      setVersionOpen(false);
      setVersionContent('');
      setVersionVariables('{}');
      setVersionChangelog('');
      void client.invalidateQueries({ queryKey: ['prompt-versions', selected?.id] });
      void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] });
    },
  });
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelName, setLabelName] = useState('production');
  const [labelVersionId, setLabelVersionId] = useState('');
  const moveLabel = useMutation({
    mutationFn: () => {
      if (!selected || !labelName.trim() || !labelVersionId) throw new Error('标签和版本不能为空');
      return api.put(`/prompts/${selected.id}/labels/${encodeURIComponent(labelName.trim())}`, {
        versionId: labelVersionId,
      });
    },
    onSuccess: () => {
      setLabelOpen(false);
      void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] });
    },
  });
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingTargetType, setBindingTargetType] = useState<'PROJECT' | 'AGENT' | 'TASK'>(
    'PROJECT',
  );
  const [bindingTargetId, setBindingTargetId] = useState('');
  const [bindingSlot, setBindingSlot] = useState('SYSTEM');
  const [bindingSelector, setBindingSelector] = useState<'LABEL' | 'VERSION'>('LABEL');
  const [bindingSelectorValue, setBindingSelectorValue] = useState('');
  const bindingTargets =
    bindingTargetType === 'PROJECT'
      ? (projects.data ?? []).map((item) => ({ value: item.id, label: item.name }))
      : bindingTargetType === 'AGENT'
        ? (agents.data ?? []).map((item) => ({ value: item.id, label: item.name }))
        : (tasks.data ?? []).map((item) => ({ value: item.id, label: item.title }));
  const bindingSelectors =
    bindingSelector === 'LABEL'
      ? (labels.data ?? []).map((item) => ({
          value: item.label,
          label: `${item.label} · v${item.version}`,
        }))
      : (versions.data ?? []).map((item) => ({
          value: item.id,
          label: `v${item.version} · ${item.changelog ?? '无变更说明'}`,
        }));
  useEffect(() => {
    if (!bindingTargets.some((item) => item.value === bindingTargetId))
      setBindingTargetId(bindingTargets[0]?.value ?? '');
  }, [bindingTargetId, bindingTargets]);
  useEffect(() => {
    if (!bindingSelectors.some((item) => item.value === bindingSelectorValue))
      setBindingSelectorValue(bindingSelectors[0]?.value ?? '');
  }, [bindingSelectorValue, bindingSelectors]);
  const createBinding = useMutation({
    mutationFn: () => {
      if (!selected || !bindingTargetId || !bindingSelectorValue)
        throw new Error('绑定目标和版本来源不能为空');
      return api.post('/prompt-bindings', {
        targetType: bindingTargetType,
        targetId: bindingTargetId,
        slot: bindingSlot,
        promptId: selected.id,
        selectorType: bindingSelector,
        ...(bindingSelector === 'LABEL'
          ? { label: bindingSelectorValue }
          : { versionId: bindingSelectorValue }),
        priority: 0,
      });
    },
    onSuccess: () => {
      setBindingOpen(false);
      void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] });
    },
  });
  const toggleBinding = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/prompt-bindings/${id}`, { enabled }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] }),
  });
  const [playground, setPlayground] = useState('{}');
  const render = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('请先选择 Prompt');
      let variables: Record<string, unknown>;
      try {
        variables = JSON.parse(playground || '{}') as Record<string, unknown>;
      } catch {
        throw new Error('变量 JSON 格式不正确');
      }
      return api.post<{ text: string }>(`/prompts/${selected.id}/render`, { variables });
    },
  });
  const tabLabels = {
    content: '内容',
    variables: '变量',
    playground: 'Playground',
    bindings: '绑定',
  };
  const selectMainTab = (nextTab: PromptMainTab) => {
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'content') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };
  const promptFilters: Array<{ value: typeof promptFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'SYSTEM', label: '系统' },
    { value: 'TASK', label: '任务' },
    { value: 'REVIEW', label: '审阅' },
    { value: 'RULE', label: '规则' },
  ];
  const refreshPrompt = () => {
    void client.invalidateQueries({ queryKey: ['prompts'] });
    void client.invalidateQueries({ queryKey: ['prompt-versions', selected?.id] });
    void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] });
    void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] });
  };
  const targetName = (binding: PromptBindingRecord) =>
    binding.targetType === 'PROJECT'
      ? (projects.data?.find((item) => item.id === binding.targetId)?.name ?? '当前 Project')
      : binding.targetType === 'AGENT'
        ? (agents.data?.find((item) => item.id === binding.targetId)?.name ?? 'Agent')
        : (tasks.data?.find((item) => item.id === binding.targetId)?.title ?? 'Task');
  const latestVersion = versions.data?.[0];
  useEffect(() => {
    const available = versions.data ?? [];
    const newest = available[0];
    if (!newest) {
      setDiffFrom('');
      setDiffTo('');
      return;
    }
    if (!available.some((version) => String(version.version) === diffFrom))
      setDiffFrom(String(available.at(-1)?.version ?? newest.version));
    if (!available.some((version) => String(version.version) === diffTo))
      setDiffTo(String(newest.version));
  }, [diffFrom, diffTo, versions.data]);
  const versionDiff = useQuery({
    queryKey: ['prompt-diff', selected?.id, diffFrom, diffTo],
    queryFn: () =>
      api.get<{ patch: string }>(`/prompts/${selected?.id}/diff?from=${diffFrom}&to=${diffTo}`),
    enabled: Boolean(selected && diffFrom && diffTo && diffFrom !== diffTo),
  });
  const contentValue =
    latestVersion?.contentJson &&
    typeof latestVersion.contentJson === 'object' &&
    'text' in latestVersion.contentJson &&
    typeof latestVersion.contentJson.text === 'string'
      ? latestVersion.contentJson.text
      : (selected?.description ?? '尚未创建版本内容。');
  const variableEntries = Object.entries(latestVersion?.variablesJson ?? {});
  return (
    <div className={promptSettingsStyles.promptPage}>
      <header className={promptSettingsStyles.pageHeader}>
        <div>
          <p className={promptSettingsStyles.eyebrow}>PROMPT ASSETS</p>
          <h1>Prompt 库</h1>
          <p>集中管理 Prompt 内容、版本、变量、标签与绑定；主工作区保持单一焦点。</p>
        </div>
        <div className={promptSettingsStyles.pageActions}>
          <AhButton leftSection={<Plus size={16} />} onClick={() => setNewOpen(true)}>
            新建 Prompt
          </AhButton>
        </div>
      </header>
      <QueryMessage
        loading={prompts.isLoading}
        error={prompts.error}
        retry={() => void prompts.refetch()}
        label="正在加载 Prompt 资产"
      />
      {!prompts.isLoading && !prompts.error ? (
        <div className={promptSettingsStyles.promptLayout}>
          <aside className={promptSettingsStyles.libraryPane} aria-label="Prompt 目录">
            <div className={promptSettingsStyles.libraryHeader}>
              <div>
                <strong>Prompt 目录</strong>
                <small>{prompts.data?.length ?? 0} 个资产</small>
              </div>
            </div>
            <label className={promptSettingsStyles.searchField}>
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="搜索 Prompt"
                placeholder="搜索 Prompt、标签或项目…"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </label>
            <div
              className={promptSettingsStyles.filterRow}
              role="group"
              aria-label="Prompt 类型筛选"
            >
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
                  }}
                >
                  <span className={promptSettingsStyles.promptRowIcon}>
                    <Tag size={14} />
                  </span>
                  <div>
                    <strong>{prompt.name}</strong>
                    <small>{prompt.key}</small>
                  </div>
                  <span className={promptSettingsStyles.rowMeta}>
                    {labelPromptKind(prompt.kind)}
                  </span>
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
          </aside>
          <section className={promptSettingsStyles.mainPane} aria-label="Prompt 编辑器">
            {selected ? (
              <>
                <header className={promptSettingsStyles.mainHeader}>
                  <div>
                    <div className={promptSettingsStyles.titleLine}>
                      <h2>{selected.name}</h2>
                      <AhStatusPill status="ACTIVE" />
                      <AhStatusPill status={latestVersion ? 'READY' : 'PENDING'} />
                    </div>
                    <p>
                      {selected.key} · {labelPromptKind(selected.kind)}
                      {latestVersion
                        ? ` · v${latestVersion.version} · ${displayDate(latestVersion.createdAt)}`
                        : ' · 尚未创建版本'}
                    </p>
                  </div>
                  <div className={promptSettingsStyles.editorActions}>
                    <AhButton size="sm" variant="default" onClick={refreshPrompt}>
                      刷新
                    </AhButton>
                    <AhButton size="sm" variant="default" onClick={() => setLifecycleOpen(true)}>
                      版本与标签
                    </AhButton>
                    <AhButton
                      size="sm"
                      onClick={() => {
                        setVersionContent(contentValue);
                        setVersionVariables(
                          JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2),
                        );
                        setVersionOpen(true);
                      }}
                    >
                      新建版本
                    </AhButton>
                  </div>
                </header>
                <nav
                  className={promptSettingsStyles.tabs}
                  aria-label="Prompt 资产分区"
                  role="tablist"
                >
                  {(Object.keys(tabLabels) as Array<keyof typeof tabLabels>).map((item) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === item}
                      key={item}
                      className={`${promptSettingsStyles.tab} ${tab === item ? promptSettingsStyles.tabActive : ''}`}
                      onClick={() => selectMainTab(item)}
                    >
                      {tabLabels[item]}
                    </button>
                  ))}
                </nav>
                <div className={promptSettingsStyles.tabContent}>
                  {tab === 'content' ? (
                    <div className={promptSettingsStyles.contentShell}>
                      <div className={promptSettingsStyles.contentToolbar}>
                        <strong>Prompt 内容</strong>
                        <div className={promptSettingsStyles.contentMeta}>
                          <span className={layout.chip}>
                            {selected.type === 'CHAT' ? 'CHAT' : '文本'}
                          </span>
                          <span className={layout.chip}>{contentValue.length} 字符</span>
                          <span className={layout.chip}>{variableEntries.length} 个变量</span>
                        </div>
                      </div>
                      <article className={promptSettingsStyles.prose}>
                        {contentValue.split(/\n{2,}/).map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                        {!contentValue.trim() ? (
                          <AhEmptyState compact title="尚未创建 Prompt 内容" />
                        ) : null}
                      </article>
                    </div>
                  ) : null}
                  {tab === 'variables' ? (
                    <>
                      <div className={promptSettingsStyles.sectionHeading}>
                        <div>
                          <h3>变量</h3>
                          <p>优先结构化查看；Raw JSON 仅在版本编辑中提供。</p>
                        </div>
                        <AhButton
                          size="sm"
                          onClick={() => {
                            setVersionContent(contentValue);
                            setVersionVariables(
                              JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2),
                            );
                            setVersionOpen(true);
                          }}
                        >
                          编辑变量
                        </AhButton>
                      </div>
                      <div className={promptSettingsStyles.variableTable}>
                        <div className={promptSettingsStyles.tableHead}>
                          <span>变量</span>
                          <span>类型</span>
                          <span>必填</span>
                          <span>说明</span>
                        </div>
                        {variableEntries.map(([name, value]) => (
                          <div key={name}>
                            <code>{name}</code>
                            <span>{typeof value}</span>
                            <span>—</span>
                            <span>由当前版本定义</span>
                          </div>
                        ))}
                        {!variableEntries.length ? (
                          <AhEmptyState
                            compact
                            title="还没有变量"
                            description="在新版本中添加结构化变量。"
                          />
                        ) : null}
                      </div>
                    </>
                  ) : null}
                  {tab === 'playground' ? (
                    <>
                      <div className={promptSettingsStyles.sectionHeading}>
                        <div>
                          <h3>Playground</h3>
                          <p>输入变量并即时预览渲染结果，测试通过后再生成新版本。</p>
                        </div>
                        <AhButton
                          size="sm"
                          onClick={() => render.mutate()}
                          loading={render.isPending}
                          leftSection={<Eye size={15} />}
                        >
                          运行预览
                        </AhButton>
                      </div>
                      <div className={promptSettingsStyles.playground}>
                        <div className={promptSettingsStyles.playgroundForm}>
                          <AhTextarea
                            label="变量 JSON"
                            value={playground}
                            onChange={(event) => setPlayground(event.currentTarget.value)}
                            placeholder="{}"
                            minRows={9}
                          />
                          <AhButton onClick={() => render.mutate()} loading={render.isPending}>
                            Render
                          </AhButton>
                          {render.error ? (
                            <AhErrorState description={render.error.message} />
                          ) : null}
                        </div>
                        <div className={promptSettingsStyles.playgroundResult}>
                          <span className={layout.eyebrow}>渲染预览</span>
                          {render.data?.text ? (
                            <p style={{ whiteSpace: 'pre-wrap' }}>{render.data.text}</p>
                          ) : (
                            <AhEmptyState
                              compact
                              title="尚未运行预览"
                              description="输入变量后运行 Render 查看最终内容。"
                            />
                          )}
                        </div>
                      </div>
                    </>
                  ) : null}
                  {tab === 'bindings' ? (
                    <>
                      <div className={promptSettingsStyles.sectionHeading}>
                        <div>
                          <h3>绑定</h3>
                          <p>显示这个 Prompt 在哪些 Project / Agent / Task 中生效。</p>
                        </div>
                        <AhButton
                          size="sm"
                          onClick={() => {
                            refreshPrompt();
                            setBindingOpen(true);
                          }}
                        >
                          新增绑定
                        </AhButton>
                      </div>
                      <div className={promptSettingsStyles.bindingList}>
                        {(bindings.data ?? []).map((binding) => (
                          <div className={promptSettingsStyles.bindingRow} key={binding.id}>
                            <span className={promptSettingsStyles.bindingAvatar}>
                              {targetName(binding).slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <strong>{targetName(binding)}</strong>
                              <small>
                                {labelPromptBindingTarget(binding.targetType)} · {binding.slot} ·{' '}
                                {labelPromptSelector(binding.selectorType)}
                              </small>
                            </div>
                            <AhStatusPill status={binding.enabled ? 'ACTIVE' : 'CANCELED'} />
                            <AhButton
                              size="xs"
                              variant="default"
                              onClick={() =>
                                toggleBinding.mutate({ id: binding.id, enabled: !binding.enabled })
                              }
                            >
                              {binding.enabled ? '停用' : '启用'}
                            </AhButton>
                          </div>
                        ))}
                        {!bindings.data?.length ? (
                          <AhEmptyState
                            compact
                            title="还没有 Binding"
                            description="将 Prompt 绑定到 Project、Agent 或 Task。"
                          />
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              <AhEmptyState
                title="选择一个 Prompt"
                description="从左侧目录选择一个资产，或创建新的 Prompt。"
                action={<AhButton onClick={() => setNewOpen(true)}>新建 Prompt</AhButton>}
              />
            )}
          </section>
        </div>
      ) : null}
      <AhDrawer
        open={lifecycleOpen}
        onClose={() => setLifecycleOpen(false)}
        title="版本与标签"
        position="right"
        size={420}
      >
        <div className={promptSettingsStyles.lifecycleDrawerIntro}>
          版本不可变；标签是指向已发布版本的可移动指针。
        </div>
        <div className={promptSettingsStyles.lifecycleGrid}>
          <section>
            <div className={promptSettingsStyles.sectionHeading}>
              <div>
                <h3>版本历史</h3>
                <p>查看变更来源，并从任意历史版本创建新版本。</p>
              </div>
              <AhButton
                size="sm"
                onClick={() => {
                  setLifecycleOpen(false);
                  setVersionContent(contentValue);
                  setVersionVariables(JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2));
                  setVersionOpen(true);
                }}
              >
                新建版本
              </AhButton>
            </div>
            <div className={promptSettingsStyles.versionList}>
              {(versions.data ?? []).map((version, index) => (
                <div
                  className={`${promptSettingsStyles.versionRow} ${index === 0 ? promptSettingsStyles.versionRowActive : ''}`}
                  key={version.id}
                >
                  <b>v{version.version}</b>
                  <span>
                    <strong>{version.changelog ?? (index === 0 ? '当前版本' : '历史版本')}</strong>
                    <small>
                      {labelPromptVersionSource(version.source)} · {displayDate(version.createdAt)}
                    </small>
                  </span>
                  {index === 0 ? (
                    <AhStatusPill status="READY" />
                  ) : (
                    <AhButton
                      size="xs"
                      variant="default"
                      onClick={() => {
                        setLifecycleOpen(false);
                        setVersionContent(
                          String((version.contentJson as { text?: unknown })?.text ?? ''),
                        );
                        setVersionVariables(JSON.stringify(version.variablesJson ?? {}, null, 2));
                        setVersionOpen(true);
                      }}
                    >
                      基于此版本
                    </AhButton>
                  )}
                </div>
              ))}
              {!versions.data?.length ? (
                <AhEmptyState compact title="还没有版本" description="创建第一个 Prompt 版本。" />
              ) : null}
            </div>
          </section>
          <section>
            <div className={promptSettingsStyles.sectionHeading}>
              <div>
                <h3>标签</h3>
                <p>控制 production、test 或实验环境使用的版本。</p>
              </div>
              <AhButton
                size="sm"
                variant="default"
                onClick={() => {
                  setLifecycleOpen(false);
                  setLabelVersionId(latestVersion?.id ?? '');
                  setLabelOpen(true);
                }}
              >
                移动标签
              </AhButton>
            </div>
            <div className={promptSettingsStyles.labelList}>
              {(labels.data ?? []).map((label) => (
                <div className={promptSettingsStyles.labelRow} key={label.label}>
                  <span>{label.label}</span>
                  <strong>v{label.version}</strong>
                  <AhButton
                    size="xs"
                    variant="default"
                    onClick={() => {
                      setLifecycleOpen(false);
                      setLabelName(label.label);
                      setLabelVersionId(latestVersion?.id ?? '');
                      setLabelOpen(true);
                    }}
                  >
                    编辑
                  </AhButton>
                </div>
              ))}
              {!labels.data?.length ? (
                <AhEmptyState
                  compact
                  title="还没有 Label"
                  description="在版本上移动 production 或 latest 标签。"
                />
              ) : null}
            </div>
          </section>
          <section className={promptSettingsStyles.diffPanel}>
            <div className={promptSettingsStyles.sectionHeading}>
              <div>
                <h3>版本比较</h3>
                <p>比较任意两个不可变版本，确认内容与变量的实际差异。</p>
              </div>
            </div>
            {(versions.data?.length ?? 0) < 2 ? (
              <AhEmptyState
                compact
                title="至少需要两个版本"
                description="创建新版本后才能比较差异。"
              />
            ) : (
              <>
                <div className={promptSettingsStyles.diffControls}>
                  <AhSelect
                    label="起始版本"
                    value={diffFrom}
                    onChange={(value) => setDiffFrom(value ?? '')}
                    data={(versions.data ?? []).map((version) => ({
                      value: String(version.version),
                      label: `v${version.version}`,
                    }))}
                  />
                  <ArrowRight size={16} aria-hidden="true" />
                  <AhSelect
                    label="目标版本"
                    value={diffTo}
                    onChange={(value) => setDiffTo(value ?? '')}
                    data={(versions.data ?? []).map((version) => ({
                      value: String(version.version),
                      label: `v${version.version}`,
                    }))}
                  />
                </div>
                {diffFrom === diffTo ? (
                  <AhEmptyState
                    compact
                    title="请选择不同版本"
                    description="起始版本和目标版本不能相同。"
                  />
                ) : versionDiff.isLoading ? (
                  <AhLoadingState label="正在比较版本" rows={1} />
                ) : versionDiff.error ? (
                  <AhErrorState description={versionDiff.error.message} />
                ) : (
                  <pre className={promptSettingsStyles.diffPatch}>{versionDiff.data?.patch}</pre>
                )}
              </>
            )}
          </section>
        </div>
      </AhDrawer>
      <AhDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="新建 Prompt"
        description="先建立资产，再逐步添加版本和绑定。"
        actions={
          <>
            <AhButton variant="default" onClick={() => setNewOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!name.trim() || !key.trim()}
            >
              创建
            </AhButton>
          </>
        }
      >
        {create.error ? <AhErrorState description={create.error.message} /> : null}
        <AhInput
          label="名称"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <AhInput
          label="Key"
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          placeholder="project/task-primer"
        />
      </AhDialog>
      <AhDialog
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title="创建新版本"
        description="版本创建后不可覆盖或删除，latest 会自动指向这次创建的版本。"
        size={760}
        actions={
          <>
            <AhButton variant="default" onClick={() => setVersionOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => versionCreate.mutate()}
              loading={versionCreate.isPending}
              disabled={!versionContent.trim()}
            >
              创建版本
            </AhButton>
          </>
        }
      >
        {versionCreate.error ? <AhErrorState description={versionCreate.error.message} /> : null}
        <AhTextarea
          label={selected?.type === 'CHAT' ? 'CHAT 内容 JSON' : 'Prompt 内容'}
          value={versionContent}
          onChange={(event) => setVersionContent(event.currentTarget.value)}
          minRows={selected?.type === 'CHAT' ? 10 : 8}
          placeholder={
            selected?.type === 'CHAT' ? '{"messages":[]}' : '输入 {{ variable }} 模板内容'
          }
        />
        <AhTextarea
          label="Variables JSON"
          value={versionVariables}
          onChange={(event) => setVersionVariables(event.currentTarget.value)}
          minRows={6}
        />
        <AhInput
          label="变更说明"
          value={versionChangelog}
          onChange={(event) => setVersionChangelog(event.currentTarget.value)}
          placeholder="说明本次变化"
        />
      </AhDialog>
      <AhDialog
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        title="移动 Prompt 标签"
        description="标签是可移动指针；latest 由系统维护。"
        actions={
          <>
            <AhButton variant="default" onClick={() => setLabelOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => moveLabel.mutate()}
              loading={moveLabel.isPending}
              disabled={!labelName.trim() || !labelVersionId}
            >
              移动标签
            </AhButton>
          </>
        }
      >
        {moveLabel.error ? <AhErrorState description={moveLabel.error.message} /> : null}
        <AhInput
          label="标签名称"
          value={labelName}
          onChange={(event) => setLabelName(event.currentTarget.value)}
        />
        <AhSelect
          label="目标版本"
          value={labelVersionId}
          onChange={(value) => setLabelVersionId(value ?? '')}
          data={(versions.data ?? []).map((version) => ({
            value: version.id,
            label: `v${version.version} · ${version.changelog ?? '无变更说明'}`,
          }))}
          placeholder="选择版本"
        />
      </AhDialog>
      <AhDialog
        open={bindingOpen}
        onClose={() => setBindingOpen(false)}
        title="新建 Prompt 绑定"
        description="选择绑定目标和版本来源；保存后会参与后续上下文解析。"
        size={680}
        actions={
          <>
            <AhButton variant="default" onClick={() => setBindingOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => createBinding.mutate()}
              loading={createBinding.isPending}
              disabled={!bindingTargetId || !bindingSelectorValue}
            >
              创建绑定
            </AhButton>
          </>
        }
      >
        {createBinding.error ? <AhErrorState description={createBinding.error.message} /> : null}
        <AhSelect
          label="绑定目标类型"
          value={bindingTargetType}
          onChange={(value) => {
            setBindingTargetType((value as typeof bindingTargetType) ?? 'PROJECT');
            setBindingTargetId('');
          }}
          data={[
            { value: 'PROJECT', label: 'Project' },
            { value: 'AGENT', label: 'Agent' },
            { value: 'TASK', label: 'Task' },
          ]}
        />
        <AhSelect
          label={labelPromptBindingTarget(bindingTargetType)}
          value={bindingTargetId}
          onChange={(value) => setBindingTargetId(value ?? '')}
          data={bindingTargets}
          placeholder="选择目标"
        />
        <AhSelect
          label="提示位"
          value={bindingSlot}
          onChange={(value) => setBindingSlot(value ?? 'SYSTEM')}
          data={[
            { value: 'SYSTEM', label: '系统' },
            { value: 'TASK_PRIMER', label: '任务前置' },
            { value: 'REVIEW', label: 'Review' },
            { value: 'COMMIT', label: 'Commit' },
            { value: 'RULES', label: '规则' },
          ]}
        />
        <AhSelect
          label="选择方式"
          value={bindingSelector}
          onChange={(value) => {
            setBindingSelector((value as typeof bindingSelector) ?? 'LABEL');
            setBindingSelectorValue('');
          }}
          data={[
            { value: 'LABEL', label: '标签' },
            { value: 'VERSION', label: '固定版本' },
          ]}
        />
        <AhSelect
          label={bindingSelector === 'LABEL' ? '标签' : '固定版本'}
          value={bindingSelectorValue}
          onChange={(value) => setBindingSelectorValue(value ?? '')}
          data={bindingSelectors}
          placeholder="选择来源"
        />
      </AhDialog>
    </div>
  );
}
