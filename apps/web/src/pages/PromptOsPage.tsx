import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Braces,
  Check,
  GitCompareArrows,
  Layers3,
  Link2,
  Plus,
  ScanSearch,
  Tag,
} from 'lucide-react';

import { EmptyState, ErrorState, formatTime, LoadingState, PageIntro } from '../components/Common';
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
} from '../lib/api';

type PromptTab = 'versions' | 'labels' | 'diff' | 'bindings' | 'playground' | 'context' | 'skills';

const tabs: Array<{ id: PromptTab; label: string }> = [
  { id: 'versions', label: '版本' },
  { id: 'labels', label: '标签' },
  { id: 'diff', label: '差异' },
  { id: 'bindings', label: '绑定' },
  { id: 'playground', label: '渲染演练' },
  { id: 'context', label: '上下文预览' },
  { id: 'skills', label: 'Skill' },
];

export function PromptOsPage() {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [tab, setTab] = useState<PromptTab>('versions');
  const [createOpen, setCreateOpen] = useState(false);
  const prompts = useQuery({
    queryKey: ['prompts'],
    queryFn: () => api.get<PromptRecord[]>('/prompts'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const createPrompt = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<PromptRecord>('/prompts', body),
    onSuccess: (created) => {
      setCreateOpen(false);
      setSelectedId(created.id);
      void client.invalidateQueries({ queryKey: ['prompts'] });
    },
  });

  useEffect(() => {
    if (!selectedId && prompts.data?.[0]) setSelectedId(prompts.data[0].id);
  }, [prompts.data, selectedId]);

  return (
    <div className="page-stack promptos-page">
      <PageIntro
        title="PromptOS"
        description="管理稳定 Prompt 标识、不可变版本、可移动标签、绑定与可复现的最终上下文。"
        action={
          <button className="button primary" onClick={() => setCreateOpen(!createOpen)}>
            <Plus size={15} /> 新建 Prompt
          </button>
        }
      />
      {createOpen && (
        <form
          className="management-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            createPrompt.mutate({
              key: String(values.key),
              name: String(values.name),
              kind: String(values.kind),
              type: String(values.type),
              ...(values.projectId ? { projectId: String(values.projectId) } : {}),
              ...(values.description ? { description: String(values.description) } : {}),
            });
          }}
        >
          <div className="form-heading">
            <div>
              <span className="section-kicker">稳定标识</span>
              <h3>创建 Prompt 资产</h3>
            </div>
            <p>稳定标识创建后，内容通过“创建新版本”追加；不会覆盖历史版本。</p>
          </div>
          <div className="form-grid">
            <label>
              key
              <input required name="key" className="mono" placeholder="review/safe-change" />
            </label>
            <label>
              名称
              <input required name="name" placeholder="安全变更审阅" />
            </label>
            <label>
              Kind
              <select name="kind" defaultValue="TASK">
                <option>SYSTEM</option>
                <option>TASK</option>
                <option>REVIEW</option>
                <option>COMMIT</option>
                <option>RULE</option>
                <option>TEMPLATE</option>
              </select>
            </label>
            <label>
              Type
              <select name="type" defaultValue="TEXT">
                <option>TEXT</option>
                <option>CHAT</option>
              </select>
            </label>
            <label className="span-two">
              Project 范围
              <select name="projectId">
                <option value="">全局</option>
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              说明
              <input name="description" placeholder="说明用途和适用范围" />
            </label>
          </div>
          <div className="form-footer">
            <button type="button" className="button secondary" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button className="button primary" disabled={createPrompt.isPending}>
              {createPrompt.isPending ? '正在创建' : '创建 Prompt 标识'}
            </button>
          </div>
          {createPrompt.error && <span className="form-error">{createPrompt.error.message}</span>}
        </form>
      )}
      <div className="promptos-layout">
        <aside className="prompt-list-panel">
          <div className="prompt-list-heading">
            <div>
              <span>Prompt 资产</span>
              <small>{prompts.data?.length ?? 0}</small>
            </div>
          </div>
          {prompts.isLoading ? (
            <LoadingState />
          ) : prompts.error ? (
            <ErrorState error={prompts.error} />
          ) : !prompts.data?.length ? (
            <EmptyState title="还没有 Prompt" description="先创建稳定标识，再追加第一个版本。" />
          ) : (
            <div className="prompt-list">
              {prompts.data.map((prompt) => (
                <button
                  key={prompt.id}
                  className={selectedId === prompt.id ? 'active' : ''}
                  onClick={() => setSelectedId(prompt.id)}
                >
                  <span className="prompt-kind">
                    <Braces size={14} />
                  </span>
                  <div>
                    <strong>{prompt.name}</strong>
                    <code>{prompt.key}</code>
                    <small>
                      {prompt.kind} · {prompt.type}
                    </small>
                  </div>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          )}
        </aside>
        <section className="prompt-detail-panel">
          {!selectedId ? (
            <EmptyState
              title="选择 Prompt"
              description="在左侧选择 Prompt 查看版本、标签和绑定。"
            />
          ) : (
            <PromptDetail
              key={selectedId}
              promptId={selectedId}
              tab={tab}
              setTab={setTab}
              projects={projects.data ?? []}
              agents={agents.data ?? []}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function PromptDetail({
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
            {prompt.data.kind} / {prompt.data.type}
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
      <div className="prompt-tabs" role="tablist" aria-label="PromptOS 功能">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
            role="tab"
            aria-selected={tab === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
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
        <button className="button primary" onClick={() => setCreateOpen(!createOpen)}>
          <Plus size={14} /> 创建新版本
        </button>
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
  const initialContent =
    prompt.type === 'TEXT'
      ? ''
      : JSON.stringify({ messages: [{ role: 'system', content: '' }] }, null, 2);
  return (
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
            variables: parseJsonObject(String(values.variables), '变量 schema'),
            changelog: String(values.changelog || ''),
          });
        } catch (parseError) {
          setParseError(parseError instanceof Error ? parseError.message : 'JSON 解析失败');
        }
      }}
    >
      <div className="editor-label">
        <strong>{prompt.type} content</strong>
        <span>
          {prompt.type === 'TEXT' ? '使用 {{ variable }} 插值' : '输入包含 messages 的 JSON'}
        </span>
      </div>
      <textarea name="content" required defaultValue={initialContent} rows={9} className="mono" />
      <div className="version-form-side">
        <label>
          变量 JSON Schema
          <textarea
            name="variables"
            className="mono"
            rows={7}
            defaultValue={'{\n  "type": "object",\n  "properties": {},\n  "required": []\n}'}
          />
        </label>
        <label>
          变更说明
          <input name="changelog" placeholder="说明本次变化" />
        </label>
      </div>
      <div className="version-warning">
        <Layers3 size={15} />
        <span>此操作会创建新版本，历史内容不可修改。</span>
      </div>
      <div className="form-footer">
        <button type="button" className="button secondary" onClick={onCancel}>
          取消
        </button>
        <button className="button primary" disabled={pending}>
          {pending ? '正在创建' : '创建新版本'}
        </button>
      </div>
      {(parseError || error) && <span className="form-error">{parseError ?? error?.message}</span>}
    </form>
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
  const move = useMutation({
    mutationFn: ({ label, versionId }: { label: string; versionId: string }) =>
      api.put(`/prompts/${promptId}/labels/${encodeURIComponent(label)}`, { versionId }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-labels', promptId] }),
  });
  return (
    <div className="prompt-section-stack">
      <div className="prompt-callout">
        <Tag size={16} />
        <div>
          <strong>标签是可移动指针</strong>
          <span>latest 由系统维护；production 或自定义标签可快速回退到旧版本。</span>
        </div>
      </div>
      <form
        className="label-form"
        onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          move.mutate({ label: String(values.label), versionId: String(values.versionId) });
        }}
      >
        <label>
          标签
          <input name="label" required placeholder="production" pattern="[A-Za-z0-9._-]+" />
        </label>
        <label>
          目标版本
          <select name="versionId" required>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.version} · {version.changelog || '无说明'}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={move.isPending}>
          移动标签
        </button>
      </form>
      {move.error && <span className="form-error">{move.error.message}</span>}
      <div className="label-list">
        {labels.map((label) => (
          <div key={label.label}>
            <span>
              <Tag size={13} /> {label.label}
            </span>
            <strong>v{label.version}</strong>
            <code>{label.versionId}</code>
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
        <label>
          起始版本
          <select value={from} onChange={(event) => setFrom(Number(event.target.value))}>
            {versions.map((version) => (
              <option key={version.id} value={version.version}>
                v{version.version}
              </option>
            ))}
          </select>
        </label>
        <ArrowRight size={14} />
        <label>
          目标版本
          <select value={to} onChange={(event) => setTo(Number(event.target.value))}>
            {versions.map((version) => (
              <option key={version.id} value={version.version}>
                v{version.version}
              </option>
            ))}
          </select>
        </label>
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
          <DiffEditor
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
  const [targetType, setTargetType] = useState<'PROJECT' | 'AGENT' | 'TASK'>('PROJECT');
  const [selector, setSelector] = useState<'LABEL' | 'VERSION'>('LABEL');
  const bindings = useQuery({
    queryKey: ['prompt-bindings', prompt.id],
    queryFn: () => api.get<PromptBindingRecord[]>(`/prompt-bindings?promptId=${prompt.id}`),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/prompt-bindings', body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-bindings', prompt.id] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/prompt-bindings/${id}`, { enabled }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-bindings', prompt.id] }),
  });
  const options = targetType === 'PROJECT' ? projects : targetType === 'AGENT' ? agents : [];
  return (
    <div className="prompt-section-stack">
      <form
        className="binding-form"
        onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          create.mutate({
            targetType,
            targetId: String(values.targetId),
            slot: String(values.slot),
            promptId: prompt.id,
            selectorType: selector,
            ...(selector === 'LABEL'
              ? { label: String(values.selectorValue) }
              : { versionId: String(values.selectorValue) }),
            priority: Number(values.priority),
          });
        }}
      >
        <label>
          目标类型
          <select
            value={targetType}
            onChange={(event) => setTargetType(event.target.value as typeof targetType)}
          >
            <option>PROJECT</option>
            <option>AGENT</option>
            <option>TASK</option>
          </select>
        </label>
        <label>
          目标标识
          {targetType === 'TASK' ? (
            <input required name="targetId" className="mono" placeholder="Task UUID" />
          ) : (
            <select required name="targetId">
              <option value="">请选择</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label>
          Slot
          <select name="slot">
            <option>SYSTEM</option>
            <option>TASK_PRIMER</option>
            <option>REVIEW</option>
            <option>COMMIT</option>
            <option>RULES</option>
          </select>
        </label>
        <label>
          选择方式
          <select
            value={selector}
            onChange={(event) => setSelector(event.target.value as typeof selector)}
          >
            <option>LABEL</option>
            <option>VERSION</option>
          </select>
        </label>
        <label>
          {selector === 'LABEL' ? '标签' : '版本'}
          <select required name="selectorValue">
            {selector === 'LABEL'
              ? labels.map((label) => (
                  <option key={label.label} value={label.label}>
                    {label.label} → v{label.version}
                  </option>
                ))
              : versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version}
                  </option>
                ))}
          </select>
        </label>
        <label>
          priority
          <input name="priority" type="number" defaultValue="0" />
        </label>
        <button className="button primary" disabled={create.isPending}>
          <Link2 size={14} /> 创建绑定
        </button>
      </form>
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
              <span className="binding-scope">{binding.targetType}</span>
              <code>{binding.targetId}</code>
              <strong>{binding.slot}</strong>
              <span>
                {binding.selectorType === 'LABEL'
                  ? `${binding.label}`
                  : `v:${binding.versionId?.slice(0, 8)}`}
              </span>
              <small>priority {binding.priority}</small>
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
        <label>
          左侧
          <select value={left} onChange={(event) => setLeft(Number(event.target.value))}>
            {versions.map((version) => (
              <option key={version.id} value={version.version}>
                v{version.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          右侧
          <select value={right} onChange={(event) => setRight(Number(event.target.value))}>
            {versions.map((version) => (
              <option key={version.id} value={version.version}>
                v{version.version}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          onClick={() => render.mutate()}
          disabled={render.isPending || !versions.length}
        >
          渲染
        </button>
      </div>
      <label className="json-field">
        变量 JSON
        <textarea
          value={variables}
          onChange={(event) => setVariables(event.target.value)}
          className="mono"
          rows={5}
        />
      </label>
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
            <DiffEditor
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
          const values = Object.fromEntries(new FormData(event.currentTarget));
          try {
            setParseError(undefined);
            resolve.mutate({
              projectId: String(values.projectId),
              ...(values.agentId ? { agentId: String(values.agentId) } : {}),
              ...(values.taskId ? { taskId: String(values.taskId) } : {}),
              variables: parseJsonObject(variables, '变量'),
            });
          } catch (error) {
            setParseError(error instanceof Error ? error.message : '变量 JSON 解析失败');
          }
        }}
      >
        <label>
          Project
          <select name="projectId" required>
            <option value="">请选择</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select name="agentId">
            <option value="">不指定</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Task 标识
          <input name="taskId" className="mono" placeholder="可选 UUID" />
        </label>
        <button className="button primary" disabled={resolve.isPending}>
          解析上下文
        </button>
      </form>
      <label className="json-field">
        变量 JSON
        <textarea
          value={variables}
          onChange={(event) => setVariables(event.target.value)}
          className="mono"
          rows={5}
        />
      </label>
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
                  <span>{item.targetType}</span>
                  <strong>{item.slot}</strong>
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
  const [targetType, setTargetType] = useState<'PROJECT' | 'AGENT' | 'TASK'>('PROJECT');
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
  const scan = useMutation({
    mutationFn: () => api.post<SkillRecord[]>('/skills/scan', { projectId }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['skills', projectId] }),
  });
  const bind = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/skill-bindings', body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['skill-bindings'] }),
  });
  const targetOptions = targetType === 'PROJECT' ? projects : targetType === 'AGENT' ? agents : [];
  return (
    <div className="prompt-section-stack">
      <div className="skills-toolbar">
        <label>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">请选择</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          onClick={() => scan.mutate()}
          disabled={!projectId || scan.isPending}
        >
          <ScanSearch size={14} /> {scan.isPending ? '正在扫描' : '扫描 Skill metadata'}
        </button>
        <p>
          只读取 `.agents/skills` 与 `.codex/skills`；不安装 Marketplace，不复制
          AGENTS.md/CLAUDE.md。
        </p>
      </div>
      {scan.error && <span className="form-error">{scan.error.message}</span>}
      {!!skills.data?.length && (
        <form
          className="skill-binding-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            bind.mutate({
              skillId: String(values.skillId),
              targetType,
              targetId: String(values.targetId),
            });
          }}
        >
          <label>
            Skill
            <select name="skillId" required>
              {skills.data.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标类型
            <select
              value={targetType}
              onChange={(event) => setTargetType(event.target.value as typeof targetType)}
            >
              <option>PROJECT</option>
              <option>AGENT</option>
              <option>TASK</option>
            </select>
          </label>
          <label>
            目标标识
            {targetType === 'TASK' ? (
              <input name="targetId" required className="mono" placeholder="Task UUID" />
            ) : (
              <select name="targetId" required>
                <option value="">请选择</option>
                {targetOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <button className="button primary" disabled={bind.isPending}>
            <Link2 size={14} /> 创建 Skill 绑定
          </button>
        </form>
      )}
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
