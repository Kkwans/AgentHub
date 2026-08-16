import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Button,
  Check,
  FormDialog,
  FormTextArea,
  FormTextField,
  GitCompareArrows,
  Layers3,
  Link2,
  Plus,
  ScanSearch,
  SelectField,
  Tag,
  Tabs,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, ErrorState, formatTime, LoadingState } from '../../../components/Common';
import { SafeDiffEditor } from '../../../components/SafeDiffEditor';
import {
  api,
  type AgentRecord,
  type ProjectRecord,
  type PromptBindingRecord,
  type PromptLabelRecord,
  type PromptRecord,
  type PromptVersionRecord,
  type RenderedPromptRecord,
  type ResolvedPromptContextRecord,
  type SkillBindingRecord,
  type SkillRecord,
  type TaskRecord,
} from '../../../lib/api';
import {
  labelAgentStatus,
  labelPromptBindingSlot,
  labelPromptBindingTarget,
  labelPromptKind,
  labelPromptSelector,
  labelPromptType,
  labelTaskStatus,
} from '../../../presentation/domain-labels';

export type PromptTab =
  'versions' | 'labels' | 'diff' | 'bindings' | 'playground' | 'context' | 'skills';

export const promptTabs: Array<{ id: PromptTab; label: string }> = [
  { id: 'versions', label: '版本' },
  { id: 'labels', label: '标签' },
  { id: 'diff', label: '差异' },
  { id: 'bindings', label: '绑定' },
  { id: 'playground', label: '渲染演练' },
  { id: 'context', label: '上下文预览' },
  { id: 'skills', label: 'Skill' },
];

export function PromptDetail({
  promptId,
  tab,
  setTab,
  projects,
  agents,
}: {
  promptId: string;
  tab: PromptTab;
  setTab: (tab: PromptTab) => void;
  projects: ProjectRecord[];
  agents: AgentRecord[];
}) {
  const prompt = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => api.get<PromptRecord>(`/prompts/${promptId}`),
  });
  const versions = useQuery({
    queryKey: ['prompt-versions', promptId],
    queryFn: () => api.get<PromptVersionRecord[]>(`/prompts/${promptId}/versions`),
  });
  const labels = useQuery({
    queryKey: ['prompt-labels', promptId],
    queryFn: () => api.get<PromptLabelRecord[]>(`/prompts/${promptId}/labels`),
  });
  if (prompt.isLoading || versions.isLoading || labels.isLoading)
    return <LoadingState label="正在加载 Prompt 版本" />;
  if (prompt.error || versions.error || labels.error)
    return <ErrorState error={(prompt.error ?? versions.error ?? labels.error)!} />;
  if (!prompt.data)
    return <EmptyState title="Prompt 不存在" description="该 Prompt 可能已归档。" />;
  return (
    <div className="prompt-detail">
      <header className="prompt-detail-header">
        <div>
          <span className="section-kicker">
            {labelPromptKind(prompt.data.kind)} / {labelPromptType(prompt.data.type)}
          </span>
          <h2>{prompt.data.name}</h2>
          <code>{prompt.data.key}</code>
          <p>{prompt.data.description || '暂无说明'}</p>
        </div>
        <div className="prompt-label-summary">
          {labels.data?.map((label) => (
            <span key={label.label}>
              <Tag size={11} /> {label.label}
              <strong>v{label.version}</strong>
            </span>
          ))}
        </div>
      </header>
      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as PromptTab)}>
        <Tabs.List className="prompt-tabs" aria-label="PromptOS 功能">
          {promptTabs.map((item) => (
            <Tabs.Trigger key={item.id} value={item.id} aria-label={item.label}>
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <div className="prompt-tab-body">
        {tab === 'versions' ? (
          <VersionsTab prompt={prompt.data} versions={versions.data ?? []} />
        ) : tab === 'labels' ? (
          <LabelsTab
            promptId={promptId}
            versions={versions.data ?? []}
            labels={labels.data ?? []}
          />
        ) : tab === 'diff' ? (
          <PromptDiffTab promptId={promptId} versions={versions.data ?? []} />
        ) : tab === 'bindings' ? (
          <BindingsTab
            prompt={prompt.data}
            versions={versions.data ?? []}
            labels={labels.data ?? []}
            projects={projects}
            agents={agents}
          />
        ) : tab === 'playground' ? (
          <PlaygroundTab prompt={prompt.data} versions={versions.data ?? []} />
        ) : tab === 'context' ? (
          <ContextTab projects={projects} agents={agents} />
        ) : (
          <SkillsTab projects={projects} agents={agents} />
        )}
      </div>
    </div>
  );
}

function VersionsTab({
  prompt,
  versions,
}: {
  prompt: PromptRecord;
  versions: PromptVersionRecord[];
}) {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(versions.length === 0);
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/prompts/${prompt.id}/versions`, body),
    onSuccess: () => {
      setCreateOpen(false);
      void client.invalidateQueries({ queryKey: ['prompt-versions', prompt.id] });
      void client.invalidateQueries({ queryKey: ['prompt-labels', prompt.id] });
    },
  });
  return (
    <div className="prompt-section-stack">
      <div className="prompt-actionbar">
        <div>
          <strong>不可变版本历史</strong>
          <span>每次保存都会 INSERT 新版本，并自动移动 latest。</span>
        </div>
        <Button onClick={() => setCreateOpen(!createOpen)}>
          <Plus size={14} /> 创建新版本
        </Button>
      </div>
      {createOpen && (
        <VersionForm
          prompt={prompt}
          pending={create.isPending}
          error={create.error}
          onCancel={() => setCreateOpen(false)}
          onSubmit={(body) => create.mutate(body)}
        />
      )}
      {!versions.length ? (
        <EmptyState
          title="还没有版本"
          description="创建第一个不可变版本后，latest 会自动指向它。"
        />
      ) : (
        <div className="version-list">
          {versions.map((version) => (
            <article key={version.id}>
              <div className="version-number">v{version.version}</div>
              <div>
                <strong>{version.changelog || '未填写变更说明'}</strong>
                <span>
                  {version.source} · {version.createdBy} · {formatTime(version.createdAt)}
                </span>
                <code title={version.contentHash}>{version.contentHash}</code>
              </div>
              <details>
                <summary>查看内容</summary>
                <pre>{JSON.stringify(version.contentJson, null, 2)}</pre>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionForm({
  prompt,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  prompt: PromptRecord;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [parseError, setParseError] = useState<string>();
  const [variableRows, setVariableRows] = useState<PromptVariableRow[]>([]);
  const [rawVariables, setRawVariables] = useState(
    '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
  );
  const [variablesMode, setVariablesMode] = useState<'builder' | 'raw'>('builder');
  const initialContent =
    prompt.type === 'TEXT'
      ? ''
      : JSON.stringify({ messages: [{ role: 'system', content: '' }] }, null, 2);
  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="创建新版本"
      description="版本创建后不可覆盖或删除，latest 会自动指向这次创建的版本。"
      size="large"
    >
      <form
        className="version-form"
        onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          try {
            setParseError(undefined);
            onSubmit({
              content:
                prompt.type === 'TEXT'
                  ? { text: String(values.content) }
                  : parseJsonObject(String(values.content), 'CHAT content'),
              variables:
                variablesMode === 'raw'
                  ? parseJsonObject(rawVariables, '变量 schema')
                  : buildVariableSchema(variableRows),
              changelog: String(values.changelog || ''),
            });
          } catch (parseError) {
            setParseError(parseError instanceof Error ? parseError.message : 'JSON 解析失败');
          }
        }}
      >
        <FormTextArea
          label={`${labelPromptType(prompt.type)}内容`}
          id="prompt-version-content"
          name="content"
          required
          defaultValue={initialContent}
          rows={9}
          className="mono"
          description={
            prompt.type === 'TEXT' ? '使用 {{ variable }} 插值。' : '输入包含 messages 的 JSON。'
          }
        />
        <div className="version-form-side">
          <PromptVariableEditor
            rows={variableRows}
            mode={variablesMode}
            rawValue={rawVariables}
            onModeChange={setVariablesMode}
            onRowsChange={setVariableRows}
            onRawChange={setRawVariables}
          />
          <FormTextField
            label="变更说明"
            id="prompt-version-changelog"
            name="changelog"
            placeholder="说明本次变化"
          />
        </div>
        <div className="version-warning">
          <Layers3 size={15} />
          <span>此操作会创建新版本，历史内容不可修改。</span>
        </div>
        <div className="form-footer">
          <Button type="button" color="gray" variant="soft" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={pending}>{pending ? '正在创建' : '创建新版本'}</Button>
        </div>
        {(parseError || error) && (
          <span className="form-error">{parseError ?? error?.message}</span>
        )}
      </form>
    </FormDialog>
  );
}

type PromptVariableType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

interface PromptVariableRow {
  id: string;
  name: string;
  type: PromptVariableType;
  required: boolean;
  defaultValue: string;
  description: string;
}

const promptVariableTypes: Array<{ value: PromptVariableType; label: string }> = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'integer', label: '整数' },
  { value: 'boolean', label: '布尔值' },
  { value: 'object', label: '对象' },
  { value: 'array', label: '列表' },
];

function buildVariableSchema(rows: PromptVariableRow[]): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const property: Record<string, unknown> = { type: row.type };
    if (row.description.trim()) property.description = row.description.trim();
    if (row.defaultValue.trim()) property.default = row.defaultValue;
    properties[name] = property;
    if (row.required) required.push(name);
  }
  return { type: 'object', properties, required };
}

function PromptVariableEditor({
  rows,
  mode,
  rawValue,
  onModeChange,
  onRowsChange,
  onRawChange,
}: {
  rows: PromptVariableRow[];
  mode: 'builder' | 'raw';
  rawValue: string;
  onModeChange: (mode: 'builder' | 'raw') => void;
  onRowsChange: (rows: PromptVariableRow[]) => void;
  onRawChange: (value: string) => void;
}) {
  const updateRow = (id: string, patch: Partial<PromptVariableRow>) =>
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <section className="prompt-variable-editor" aria-labelledby="prompt-variable-editor-title">
      <div className="prompt-variable-editor-heading">
        <div>
          <strong id="prompt-variable-editor-title">变量</strong>
          <span>用结构化字段声明模板需要的变量，发送前会自动检查必填项。</span>
        </div>
        <div className="prompt-variable-mode" role="group" aria-label="变量编辑方式">
          <button
            type="button"
            className={mode === 'builder' ? 'active' : ''}
            onClick={() => onModeChange('builder')}
          >
            字段编辑
          </button>
          <button
            type="button"
            className={mode === 'raw' ? 'active' : ''}
            onClick={() => onModeChange('raw')}
          >
            Raw JSON
          </button>
        </div>
      </div>
      {mode === 'raw' ? (
        <FormTextArea
          label="变量 JSON Schema"
          id="prompt-variables-raw"
          className="mono"
          rows={8}
          value={rawValue}
          onChange={(event) => onRawChange(event.target.value)}
          description="高级模式：必须是 object JSON Schema。"
        />
      ) : (
        <div className="prompt-variable-rows">
          {rows.map((row) => (
            <div className="prompt-variable-row" key={row.id}>
              <input
                aria-label="变量名称"
                placeholder="变量名称"
                value={row.name}
                onChange={(event) => updateRow(row.id, { name: event.target.value })}
              />
              <select
                aria-label={`${row.name || '变量'}类型`}
                value={row.type}
                onChange={(event) =>
                  updateRow(row.id, { type: event.target.value as PromptVariableType })
                }
              >
                {promptVariableTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`${row.name || '变量'}默认值`}
                placeholder="默认值（可选）"
                value={row.defaultValue}
                onChange={(event) => updateRow(row.id, { defaultValue: event.target.value })}
              />
              <input
                aria-label={`${row.name || '变量'}说明`}
                placeholder="说明（可选）"
                value={row.description}
                onChange={(event) => updateRow(row.id, { description: event.target.value })}
              />
              <label className="prompt-variable-required">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(event) => updateRow(row.id, { required: event.target.checked })}
                />
                必填
              </label>
              <Button
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => onRowsChange(rows.filter((item) => item.id !== row.id))}
              >
                删除
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="2"
            variant="soft"
            color="gray"
            onClick={() =>
              onRowsChange([
                ...rows,
                {
                  id: `variable-${Date.now()}-${rows.length}`,
                  name: '',
                  type: 'string',
                  required: false,
                  defaultValue: '',
                  description: '',
                },
              ])
            }
          >
            <Plus size={14} /> 添加变量
          </Button>
          {!rows.length ? (
            <span className="prompt-variable-empty">暂无变量，直接创建也可以。</span>
          ) : null}
        </div>
      )}
    </section>
  );
}

function LabelsTab({
  promptId,
  versions,
  labels,
}: {
  promptId: string;
  versions: PromptVersionRecord[];
  labels: PromptLabelRecord[];
}) {
  const client = useQueryClient();
  const [moveOpen, setMoveOpen] = useState(false);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? '');
  const move = useMutation({
    mutationFn: ({ label, versionId }: { label: string; versionId: string }) =>
      api.put(`/prompts/${promptId}/labels/${encodeURIComponent(label)}`, { versionId }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-labels', promptId] }),
  });
  useEffect(() => {
    if (!versions.some((version) => version.id === versionId)) {
      setVersionId(versions[0]?.id ?? '');
    }
  }, [versionId, versions]);
  return (
    <div className="prompt-section-stack">
      <div className="prompt-callout">
        <Tag size={16} />
        <div>
          <strong>标签是可移动指针</strong>
          <span>latest 由系统维护；production 或自定义标签可快速回退到旧版本。</span>
        </div>
      </div>
      <Button onClick={() => setMoveOpen(true)} disabled={!versions.length}>
        <Tag size={14} /> 移动标签
      </Button>
      <FormDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        title="移动 Prompt 标签"
        description="标签是可移动指针；保存后会立即指向选中的不可变版本。latest 由系统维护，不能手动移动。"
        footer={
          <>
            <Button type="button" color="gray" variant="soft" onClick={() => setMoveOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              form="prompt-label-form"
              disabled={move.isPending || !versions.length || !versionId}
              loading={move.isPending}
            >
              移动标签
            </Button>
          </>
        }
      >
        <form
          id="prompt-label-form"
          className="v06-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            move.mutate(
              { label: String(values.label).trim(), versionId },
              { onSuccess: () => setMoveOpen(false) },
            );
          }}
        >
          <FormTextField
            label="标签"
            id="prompt-label-name"
            name="label"
            required
            pattern="[A-Za-z0-9._-]+"
            placeholder="production"
            description="使用英文、数字、点、下划线或短横线。"
          />
          <SelectField
            label="目标版本"
            id="prompt-label-version"
            value={versionId || '__none__'}
            onValueChange={(value) => setVersionId(value === '__none__' ? '' : value)}
            options={
              versions.length
                ? versions.map((version) => ({
                    value: version.id,
                    label: `v${version.version}`,
                    description: version.changelog || '无说明',
                  }))
                : [{ value: '__none__', label: '暂无版本', disabled: true }]
            }
            required
          />
          {move.error ? <span className="v06-form-error">{move.error.message}</span> : null}
        </form>
      </FormDialog>
      <div className="label-list">
        {labels.map((label) => (
          <div key={label.label}>
            <span>
              <Tag size={13} /> {label.label}
            </span>
            <strong>v{label.version}</strong>
            <small>{label.label === 'latest' ? '系统维护' : formatTime(label.updatedAt)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptDiffTab({
  promptId,
  versions,
}: {
  promptId: string;
  versions: PromptVersionRecord[];
}) {
  const [from, setFrom] = useState(versions.at(-1)?.version ?? 1);
  const [to, setTo] = useState(versions[0]?.version ?? 1);
  const diff = useQuery({
    queryKey: ['prompt-diff', promptId, from, to],
    queryFn: () =>
      api.get<{
        fromContent: Record<string, unknown>;
        toContent: Record<string, unknown>;
        patch: string;
      }>(`/prompts/${promptId}/diff?from=${from}&to=${to}`),
    enabled: versions.length > 1 && from !== to,
  });
  return (
    <div className="prompt-section-stack">
      <div className="compare-controls">
        <GitCompareArrows size={16} />
        <SelectField
          label="起始版本"
          id="prompt-diff-from"
          value={String(from)}
          onValueChange={(value) => setFrom(Number(value))}
          options={versions.map((version) => ({
            value: String(version.version),
            label: `v${version.version}`,
          }))}
        />
        <ArrowRight size={14} />
        <SelectField
          label="目标版本"
          id="prompt-diff-to"
          value={String(to)}
          onValueChange={(value) => setTo(Number(value))}
          options={versions.map((version) => ({
            value: String(version.version),
            label: `v${version.version}`,
          }))}
        />
      </div>
      {versions.length < 2 ? (
        <EmptyState title="至少需要两个版本" description="创建新版本后才能比较差异。" />
      ) : from === to ? (
        <EmptyState title="请选择不同版本" description="起始版本和目标版本不能相同。" />
      ) : diff.isLoading ? (
        <LoadingState />
      ) : diff.error ? (
        <ErrorState error={diff.error} />
      ) : (
        <div className="prompt-diff-editor">
          <SafeDiffEditor
            height="100%"
            original={JSON.stringify(diff.data?.fromContent, null, 2)}
            modified={JSON.stringify(diff.data?.toContent, null, 2)}
            language="json"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              renderSideBySide: true,
            }}
          />
        </div>
      )}
    </div>
  );
}

function BindingsTab({
  prompt,
  versions,
  labels,
  projects,
  agents,
}: {
  prompt: PromptRecord;
  versions: PromptVersionRecord[];
  labels: PromptLabelRecord[];
  projects: ProjectRecord[];
  agents: AgentRecord[];
}) {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [targetType, setTargetType] = useState<'PROJECT' | 'AGENT' | 'TASK'>('PROJECT');
  const [selector, setSelector] = useState<'LABEL' | 'VERSION'>('LABEL');
  const [scopeProjectId, setScopeProjectId] = useState(projects[0]?.id ?? '');
  const [targetId, setTargetId] = useState('');
  const [slot, setSlot] = useState('SYSTEM');
  const [selectorValue, setSelectorValue] = useState(labels[0]?.label ?? '');
  const [priority, setPriority] = useState('0');
  useEffect(() => {
    if (!scopeProjectId && projects[0]) setScopeProjectId(projects[0].id);
  }, [projects, scopeProjectId]);
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<TaskRecord[]>('/tasks'),
  });
  const bindings = useQuery({
    queryKey: ['prompt-bindings', prompt.id],
    queryFn: () => api.get<PromptBindingRecord[]>(`/prompt-bindings?promptId=${prompt.id}`),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/prompt-bindings', body),
    onSuccess: () => {
      setCreateOpen(false);
      void client.invalidateQueries({ queryKey: ['prompt-bindings', prompt.id] });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/prompt-bindings/${id}`, { enabled }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-bindings', prompt.id] }),
  });
  const scopeProject = projects.find((project) => project.id === scopeProjectId);
  const targetOptions =
    targetType === 'PROJECT'
      ? projects.map((project) => ({ value: project.id, label: project.name }))
      : targetType === 'AGENT'
        ? agents
            .filter((agent) => agent.targetId === scopeProject?.targetId)
            .map((agent) => ({
              value: agent.id,
              label: agent.name,
              description: labelAgentStatus(agent.status),
            }))
        : (tasks.data ?? [])
            .filter((task) => task.projectId === scopeProjectId)
            .map((task) => ({
              value: task.id,
              label: task.title,
              description: labelTaskStatus(task.status),
            }));
  const selectorOptions =
    selector === 'LABEL'
      ? labels.map((label) => ({
          value: label.label,
          label: label.label,
          description: `当前指向 v${label.version}`,
        }))
      : versions.map((version) => ({
          value: version.id,
          label: `v${version.version}`,
          description: version.changelog || '未填写变更说明',
        }));
  const targetSelectOptions = targetOptions.length
    ? targetOptions
    : [{ value: '__none__', label: '暂无可选目标', disabled: true }];
  const selectorSelectOptions = selectorOptions.length
    ? selectorOptions
    : [{ value: '__none__', label: '暂无版本或标签', disabled: true }];
  useEffect(() => {
    if (!targetOptions.some((option) => option.value === targetId)) {
      setTargetId(targetOptions[0]?.value ?? '');
    }
  }, [targetId, targetOptions]);
  useEffect(() => {
    if (!selectorOptions.some((option) => option.value === selectorValue)) {
      setSelectorValue(selectorOptions[0]?.value ?? '');
    }
  }, [selectorOptions, selectorValue]);
  const bindingTargetLabel = (binding: PromptBindingRecord) => {
    if (binding.targetType === 'PROJECT') {
      return projects.find((project) => project.id === binding.targetId)?.name;
    }
    if (binding.targetType === 'AGENT') {
      return agents.find((agent) => agent.id === binding.targetId)?.name;
    }
    return tasks.data?.find((task) => task.id === binding.targetId)?.title;
  };
  const bindingSelectorLabel = (binding: PromptBindingRecord) => {
    if (binding.selectorType === 'LABEL') {
      return binding.label ? `标签：${binding.label}` : '标签已删除';
    }
    const version = versions.find((item) => item.id === binding.versionId);
    return version ? `固定版本 v${version.version}` : '固定版本已删除';
  };
  return (
    <div className="prompt-section-stack">
      <div className="prompt-actionbar">
        <div>
          <strong>绑定生效范围</strong>
          <span>按 Project → Agent → Task 和优先级解析 Prompt 来源。</span>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!projects.length}>
          <Plus size={14} /> 新建绑定
        </Button>
      </div>
      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建 Prompt 绑定"
        description="选择绑定目标和版本来源；保存后会参与后续上下文解析。"
        size="medium"
        footer={
          <>
            <Button type="button" color="gray" variant="soft" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              form="prompt-binding-form"
              disabled={create.isPending || !targetId || !selectorValue}
              loading={create.isPending}
            >
              创建绑定
            </Button>
          </>
        }
      >
        <form
          id="prompt-binding-form"
          className="v06-form"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              targetType,
              targetId,
              slot,
              promptId: prompt.id,
              selectorType: selector,
              ...(selector === 'LABEL' ? { label: selectorValue } : { versionId: selectorValue }),
              priority: Number(priority) || 0,
            });
          }}
        >
          <SelectField
            label="绑定目标"
            id="prompt-binding-target-type"
            value={targetType}
            onValueChange={(value) => {
              setTargetType(value as typeof targetType);
              setTargetId('');
            }}
            options={(['PROJECT', 'AGENT', 'TASK'] as const).map((value) => ({
              value,
              label: labelPromptBindingTarget(value),
            }))}
          />
          {targetType !== 'PROJECT' ? (
            <SelectField
              label="Project 范围"
              id="prompt-binding-project-scope"
              value={scopeProjectId || '__none__'}
              onValueChange={(value) => setScopeProjectId(value === '__none__' ? '' : value)}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
              disabled={!projects.length}
            />
          ) : null}
          <SelectField
            label={labelPromptBindingTarget(targetType)}
            id="prompt-binding-target"
            value={targetId || '__none__'}
            onValueChange={(value) => setTargetId(value === '__none__' ? '' : value)}
            options={targetSelectOptions}
            disabled={!targetOptions.length}
            required
            {...(!targetOptions.length ? { description: '当前范围没有可选目标。' } : {})}
          />
          <SelectField
            label="提示位"
            id="prompt-binding-slot"
            value={slot}
            onValueChange={setSlot}
            options={['SYSTEM', 'TASK_PRIMER', 'REVIEW', 'COMMIT', 'RULES'].map((value) => ({
              value,
              label: labelPromptBindingSlot(value),
            }))}
          />
          <SelectField
            label="选择方式"
            id="prompt-binding-selector"
            value={selector}
            onValueChange={(value) => {
              setSelector(value as typeof selector);
              setSelectorValue('');
            }}
            options={(['LABEL', 'VERSION'] as const).map((value) => ({
              value,
              label: labelPromptSelector(value),
            }))}
          />
          <SelectField
            label={selector === 'LABEL' ? '标签' : '固定版本'}
            id="prompt-binding-selector-value"
            value={selectorValue || '__none__'}
            onValueChange={(value) => setSelectorValue(value === '__none__' ? '' : value)}
            options={selectorSelectOptions}
            disabled={!selectorOptions.length}
            required
            {...(!selectorOptions.length ? { description: '请先创建版本或标签。' } : {})}
          />
          <FormTextField
            label="优先级"
            type="number"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            description="数字越大，解析时优先级越高。"
          />
          {create.error ? <span className="v06-form-error">{create.error.message}</span> : null}
        </form>
      </FormDialog>
      {create.error && <span className="form-error">{create.error.message}</span>}
      {bindings.isLoading ? (
        <LoadingState />
      ) : bindings.error ? (
        <ErrorState error={bindings.error} />
      ) : !bindings.data?.length ? (
        <EmptyState
          title="没有绑定"
          description="将 Prompt 的标签或版本绑定到 Project、Agent 或 Task。"
        />
      ) : (
        <div className="binding-list">
          {bindings.data.map((binding) => (
            <div key={binding.id}>
              <span className="binding-scope">{labelPromptBindingTarget(binding.targetType)}</span>
              <strong>{bindingTargetLabel(binding) ?? '目标已删除或不在当前范围'}</strong>
              <strong>{labelPromptBindingSlot(binding.slot)}</strong>
              <span>{bindingSelectorLabel(binding)}</span>
              <small>优先级：{binding.priority}</small>
              <button
                className={`toggle-control ${binding.enabled ? 'on' : ''}`}
                onClick={() => toggle.mutate({ id: binding.id, enabled: !binding.enabled })}
                aria-label={binding.enabled ? '停用绑定' : '启用绑定'}
              >
                <span />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaygroundTab({
  prompt,
  versions,
}: {
  prompt: PromptRecord;
  versions: PromptVersionRecord[];
}) {
  const [left, setLeft] = useState(versions.at(-1)?.version ?? 1);
  const [right, setRight] = useState(versions[0]?.version ?? 1);
  const [variables, setVariables] = useState('{}');
  const render = useMutation({
    mutationFn: async () => {
      const parsed = parseJsonObject(variables, '变量');
      return Promise.all([
        api.post<RenderedPromptRecord>(`/prompts/${prompt.id}/render`, {
          version: left,
          variables: parsed,
        }),
        api.post<RenderedPromptRecord>(`/prompts/${prompt.id}/render`, {
          version: right,
          variables: parsed,
        }),
      ]);
    },
  });
  return (
    <div className="prompt-section-stack">
      <div className="playground-toolbar">
        <div>
          <strong>本地渲染对比</strong>
          <span>不调用 Agent，不会修改 Project。</span>
        </div>
        <SelectField
          label="左侧版本"
          id="prompt-playground-left"
          value={String(left)}
          onValueChange={(value) => setLeft(Number(value))}
          options={versions.map((version) => ({
            value: String(version.version),
            label: `v${version.version}`,
          }))}
        />
        <SelectField
          label="右侧版本"
          id="prompt-playground-right"
          value={String(right)}
          onValueChange={(value) => setRight(Number(value))}
          options={versions.map((version) => ({
            value: String(version.version),
            label: `v${version.version}`,
          }))}
        />
        <Button onClick={() => render.mutate()} disabled={render.isPending || !versions.length}>
          渲染
        </Button>
      </div>
      <FormTextArea
        label="变量 JSON"
        id="prompt-playground-variables"
        value={variables}
        onChange={(event) => setVariables(event.target.value)}
        className="mono"
        rows={5}
        description="请输入 object JSON；渲染演练不会调用 Agent。"
      />
      {render.error && <span className="form-error">{render.error.message}</span>}
      {render.data ? (
        <>
          <div className="render-status">
            {render.data.flatMap((item) => item.missingVariables).length ? (
              <span className="missing">
                缺少变量：
                {[...new Set(render.data.flatMap((item) => item.missingVariables))].join('、')}
              </span>
            ) : (
              <span className="ready">
                <Check size={13} /> 变量完整
              </span>
            )}
          </div>
          <div className="playground-diff">
            <SafeDiffEditor
              height="100%"
              original={render.data[0].text}
              modified={render.data[1].text}
              language={prompt.type === 'TEXT' ? 'markdown' : 'json'}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                renderSideBySide: true,
              }}
            />
          </div>
        </>
      ) : (
        <EmptyState title="等待渲染" description="选择两个版本，填写变量后查看并排差异。" />
      )}
    </div>
  );
}

function ContextTab({ projects, agents }: { projects: ProjectRecord[]; agents: AgentRecord[] }) {
  const [variables, setVariables] = useState('{}');
  const [parseError, setParseError] = useState<string>();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [agentId, setAgentId] = useState('');
  const [taskId, setTaskId] = useState('');
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  const project = projects.find((item) => item.id === projectId);
  const projectAgents = agents.filter((agent) => agent.targetId === project?.targetId);
  const tasks = useQuery({
    queryKey: ['prompt-context-tasks', projectId],
    queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${encodeURIComponent(projectId)}`),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectAgents.some((agent) => agent.id === agentId)) setAgentId('');
  }, [agentId, projectAgents]);
  useEffect(() => {
    if (!tasks.data?.some((task) => task.id === taskId)) setTaskId('');
  }, [taskId, tasks.data]);
  const resolve = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<ResolvedPromptContextRecord>('/prompt-context/resolve', body),
  });
  return (
    <div className="prompt-section-stack">
      <form
        className="context-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            setParseError(undefined);
            resolve.mutate({
              projectId,
              ...(agentId ? { agentId } : {}),
              ...(taskId ? { taskId } : {}),
              variables: parseJsonObject(variables, '变量'),
            });
          } catch (error) {
            setParseError(error instanceof Error ? error.message : '变量 JSON 解析失败');
          }
        }}
      >
        <SelectField
          label="Project"
          id="prompt-context-project"
          value={projectId || '__none__'}
          onValueChange={(value) => {
            setProjectId(value === '__none__' ? '' : value);
            setAgentId('');
            setTaskId('');
          }}
          options={
            projects.length
              ? projects.map((item) => ({ value: item.id, label: item.name }))
              : [{ value: '__none__', label: '暂无 Project', disabled: true }]
          }
          required
          disabled={!projects.length}
        />
        <SelectField
          label="Agent"
          id="prompt-context-agent"
          value={agentId || '__none__'}
          onValueChange={(value) => setAgentId(value === '__none__' ? '' : value)}
          options={[
            { value: '__none__', label: '不指定' },
            ...projectAgents.map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
          disabled={!projectAgents.length}
        />
        <SelectField
          label="Task"
          id="prompt-context-task"
          value={taskId || '__none__'}
          onValueChange={(value) => setTaskId(value === '__none__' ? '' : value)}
          options={[
            { value: '__none__', label: '不指定' },
            ...(tasks.data ?? []).map((task) => ({ value: task.id, label: task.title })),
          ]}
          description="通过任务名称选择，不需要复制内部 ID。"
          disabled={!tasks.data?.length}
        />
        <Button disabled={resolve.isPending || !projectId}>解析上下文</Button>
      </form>
      <FormTextArea
        label="变量 JSON"
        id="prompt-context-variables"
        value={variables}
        onChange={(event) => setVariables(event.target.value)}
        className="mono"
        rows={5}
        description="请输入 object JSON；只用于本地解析上下文。"
      />
      {(parseError || resolve.error) && (
        <span className="form-error">{parseError ?? resolve.error?.message}</span>
      )}
      {resolve.data ? (
        <div className="context-result">
          <div className={`context-readiness ${resolve.data.ready ? 'ready' : 'missing'}`}>
            {resolve.data.ready ? (
              <>
                <Check size={15} /> 上下文已就绪
              </>
            ) : (
              <>缺少变量：{resolve.data.missingVariables.join('、')}</>
            )}
          </div>
          <div className="provenance-list">
            {resolve.data.items.map((item) => (
              <article key={item.bindingId}>
                <div>
                  <span>{labelPromptBindingTarget(item.targetType)}</span>
                  <strong>{labelPromptBindingSlot(item.slot)}</strong>
                  <code>
                    {item.promptKey}@{item.label ?? `v${item.version}`}
                  </code>
                </div>
                <small>
                  v{item.version} · {item.contentHash}
                </small>
                <pre>{item.renderedText}</pre>
              </article>
            ))}
          </div>
          <div className="final-context">
            <strong>最终注入内容</strong>
            <pre>{resolve.data.finalContext || '（没有生效的绑定）'}</pre>
          </div>
        </div>
      ) : (
        <EmptyState
          title="等待解析"
          description="按 Project → Agent → Task 和 priority 查看最终内容与来源记录。"
        />
      )}
    </div>
  );
}

function SkillsTab({ projects, agents }: { projects: ProjectRecord[]; agents: AgentRecord[] }) {
  const client = useQueryClient();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [bindOpen, setBindOpen] = useState(false);
  const [targetType, setTargetType] = useState<'PROJECT' | 'AGENT' | 'TASK'>('PROJECT');
  const [skillId, setSkillId] = useState('');
  const [targetId, setTargetId] = useState('');
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  const skills = useQuery({
    queryKey: ['skills', projectId],
    queryFn: () => api.get<SkillRecord[]>(`/skills?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  const bindings = useQuery({
    queryKey: ['skill-bindings'],
    queryFn: () => api.get<SkillBindingRecord[]>('/skill-bindings'),
  });
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<TaskRecord[]>('/tasks'),
  });
  const scan = useMutation({
    mutationFn: () => api.post<SkillRecord[]>('/skills/scan', { projectId }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['skills', projectId] }),
  });
  const bind = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/skill-bindings', body),
    onSuccess: () => {
      setBindOpen(false);
      void client.invalidateQueries({ queryKey: ['skill-bindings'] });
    },
  });
  const scopeProject = projects.find((project) => project.id === projectId);
  const targetOptions =
    targetType === 'PROJECT'
      ? scopeProject
        ? [{ value: scopeProject.id, label: scopeProject.name }]
        : []
      : targetType === 'AGENT'
        ? agents
            .filter((agent) => agent.targetId === scopeProject?.targetId)
            .map((agent) => ({
              value: agent.id,
              label: `${agent.name} · ${labelAgentStatus(agent.status)}`,
            }))
        : (tasks.data ?? [])
            .filter((task) => task.projectId === projectId)
            .map((task) => ({
              value: task.id,
              label: `${task.title} · ${labelTaskStatus(task.status)}`,
            }));
  useEffect(() => {
    if (!skillId && skills.data?.[0]) setSkillId(skills.data[0].id);
  }, [skillId, skills.data]);
  useEffect(() => {
    if (!targetOptions.some((option) => option.value === targetId)) {
      setTargetId(targetOptions[0]?.value ?? '');
    }
  }, [targetId, targetOptions]);
  return (
    <div className="prompt-section-stack">
      <div className="skills-toolbar">
        <SelectField
          label="Project"
          id="skill-project"
          value={projectId || '__none__'}
          onValueChange={(value) => {
            setProjectId(value === '__none__' ? '' : value);
            setTargetId('');
          }}
          options={
            projects.length
              ? projects.map((project) => ({ value: project.id, label: project.name }))
              : [{ value: '__none__', label: '暂无 Project', disabled: true }]
          }
          disabled={!projects.length}
        />
        <Button onClick={() => scan.mutate()} disabled={!projectId || scan.isPending}>
          <ScanSearch size={14} /> {scan.isPending ? '正在扫描' : '扫描 Skill metadata'}
        </Button>
        <Button onClick={() => setBindOpen(true)} disabled={!skills.data?.length} variant="soft">
          <Link2 size={14} /> 新建绑定
        </Button>
        <p>
          只读取 `.agents/skills` 与 `.codex/skills`；不安装 Marketplace，不复制
          AGENTS.md/CLAUDE.md。
        </p>
      </div>
      {scan.error && <span className="form-error">{scan.error.message}</span>}
      <FormDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        title="新建 Skill 绑定"
        description="将已扫描的 Skill metadata 绑定到 Project、Agent 或 Task。不会安装 Skill。"
        footer={
          <>
            <Button type="button" color="gray" variant="soft" onClick={() => setBindOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              form="skill-binding-form"
              disabled={bind.isPending || !skillId || !targetId}
              loading={bind.isPending}
            >
              创建绑定
            </Button>
          </>
        }
      >
        <form
          id="skill-binding-form"
          className="v06-form"
          onSubmit={(event) => {
            event.preventDefault();
            bind.mutate({ skillId, targetType, targetId });
          }}
        >
          <SelectField
            label="Skill"
            id="skill-binding-skill"
            value={skillId || '__none__'}
            onValueChange={(value) => setSkillId(value === '__none__' ? '' : value)}
            options={
              skills.data?.length
                ? skills.data.map((skill) => ({ value: skill.id, label: skill.name }))
                : [{ value: '__none__', label: '暂无 Skill', disabled: true }]
            }
            required
          />
          <SelectField
            label="绑定目标"
            id="skill-binding-target-type"
            value={targetType}
            onValueChange={(value) => {
              setTargetType(value as typeof targetType);
              setTargetId('');
            }}
            options={(['PROJECT', 'AGENT', 'TASK'] as const).map((value) => ({
              value,
              label: labelPromptBindingTarget(value),
            }))}
          />
          <SelectField
            label={labelPromptBindingTarget(targetType)}
            id="skill-binding-target"
            value={targetId || '__none__'}
            onValueChange={(value) => setTargetId(value === '__none__' ? '' : value)}
            options={
              targetOptions.length
                ? targetOptions
                : [{ value: '__none__', label: '暂无可选目标', disabled: true }]
            }
            disabled={!targetOptions.length}
            required
            {...(!targetOptions.length ? { description: '当前范围没有可选目标。' } : {})}
          />
          {bind.error ? <span className="v06-form-error">{bind.error.message}</span> : null}
        </form>
      </FormDialog>
      {bind.error && <span className="form-error">{bind.error.message}</span>}
      {skills.isLoading ? (
        <LoadingState />
      ) : skills.error ? (
        <ErrorState error={skills.error} />
      ) : !skills.data?.length ? (
        <EmptyState
          title="没有发现 Skill"
          description="扫描 Project 内已有 Skill metadata，不会执行安装。"
        />
      ) : (
        <div className="skill-list">
          {skills.data.map((skill) => (
            <article key={skill.id}>
              <span className="prompt-kind">
                <ScanSearch size={15} />
              </span>
              <div>
                <strong>{skill.name}</strong>
                <code>{skill.rootPath}</code>
                <p>{skill.description || '暂无说明'}</p>
              </div>
              <small>
                {skill.source}
                <br />
                {skill.contentHash.slice(0, 12)}
                <br />
                {bindings.data?.filter((binding) => binding.skillId === skill.id).length ?? 0} 个
                绑定
              </small>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label}必须是合法 JSON object`);
  }
}
