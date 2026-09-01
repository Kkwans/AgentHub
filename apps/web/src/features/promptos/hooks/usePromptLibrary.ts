import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import type {
  AgentRecord,
  PromptBindingRecord,
  PromptLabelRecord,
  PromptRecord,
  PromptVersionRecord,
  ProjectRecord,
  TaskRecord,
} from '../../../lib/api';
import { api } from '../../../lib/api';

export type PromptMainTab = 'content' | 'variables' | 'bindings' | 'playground';
export type PromptFilter = 'all' | 'SYSTEM' | 'TASK' | 'REVIEW' | 'RULE';
export type PromptBindingTargetType = 'PROJECT' | 'AGENT' | 'TASK';
export type PromptBindingSelector = 'LABEL' | 'VERSION';

export function usePromptLibrary() {
  const client = useQueryClient();
  const routeParams = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = routeParams.projectId ?? searchParams.get('projectId') ?? undefined;
  const promptId = routeParams.promptId ?? searchParams.get('promptId') ?? '';
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

  const [selectedId, setSelectedId] = useState(promptId);
  const [tab, setTab] = useState<PromptMainTab>(initialTab);
  const [search, setSearch] = useState('');
  const [promptFilter, setPromptFilter] = useState<PromptFilter>('all');
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
  const [bindingTargetType, setBindingTargetType] = useState<PromptBindingTargetType>('PROJECT');
  const [bindingTargetId, setBindingTargetId] = useState('');
  const [bindingSlot, setBindingSlot] = useState('SYSTEM');
  const [bindingSelector, setBindingSelector] = useState<PromptBindingSelector>('LABEL');
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
  } as const;
  const selectMainTab = (nextTab: PromptMainTab) => {
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'content') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };
  const promptFilters: Array<{ value: PromptFilter; label: string }> = [
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

  return {
    projectId,
    searchParams,
    setSearchParams,
    prompts,
    projects,
    agents,
    tasks,
    selected,
    selectedId,
    setSelectedId,
    filteredPrompts,
    search,
    setSearch,
    promptFilter,
    setPromptFilter,
    promptFilters,
    tab,
    setTab,
    tabLabels,
    selectMainTab,
    versions,
    labels,
    bindings,
    latestVersion,
    contentValue,
    variableEntries,
    versionDiff,
    diffFrom,
    setDiffFrom,
    diffTo,
    setDiffTo,
    refreshPrompt,
    targetName,
    newOpen,
    setNewOpen,
    name,
    setName,
    key,
    setKey,
    create,
    versionOpen,
    setVersionOpen,
    versionContent,
    setVersionContent,
    versionVariables,
    setVersionVariables,
    versionChangelog,
    setVersionChangelog,
    versionCreate,
    lifecycleOpen,
    setLifecycleOpen,
    labelOpen,
    setLabelOpen,
    labelName,
    setLabelName,
    labelVersionId,
    setLabelVersionId,
    moveLabel,
    bindingOpen,
    setBindingOpen,
    bindingTargetType,
    setBindingTargetType,
    bindingTargetId,
    setBindingTargetId,
    bindingTargets,
    bindingSlot,
    setBindingSlot,
    bindingSelector,
    setBindingSelector,
    bindingSelectorValue,
    setBindingSelectorValue,
    bindingSelectors,
    createBinding,
    toggleBinding,
    playground,
    setPlayground,
    render,
  };
}

export type PromptLibraryModel = ReturnType<typeof usePromptLibrary>;
