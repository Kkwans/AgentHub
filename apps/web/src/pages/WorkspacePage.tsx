import { useEffect, useState } from 'react';
import {
  Bot,
  Braces,
  Button,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileCode2,
  Files,
  GitBranch,
  IconButton,
  ListChecks,
  Send,
  ShieldCheck,
  SquareTerminal,
  Tabs,
  Wrench,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Link, useParams } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/Common';
import {
  api,
  type AgentRecord,
  type ApprovalRecord,
  type EventRecord,
  type FileEntry,
  type MessageRecord,
  type ProjectRecord,
  type ResolvedPromptContextRecord,
  type RunRecord,
  type SessionRecord,
} from '../lib/api';
import { realtime } from '../lib/realtime';
import '../styles/v3-workspace.css';

type InspectorTab = 'files' | 'diff' | 'git' | 'run';

export function WorkspacePage() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState<InspectorTab>('files');
  const [selectedFile, setSelectedFile] = useState<string>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [promptVariables, setPromptVariables] = useState<Record<string, unknown>>({});
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  const session = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.get<SessionRecord>(`/sessions/${id}`),
    enabled: Boolean(id),
  });
  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api.get<MessageRecord[]>(`/sessions/${id}/messages`),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });
  const runs = useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.get<RunRecord[]>(`/sessions/${id}/runs`),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });
  const approvals = useQuery({
    queryKey: ['approvals', id],
    queryFn: () => api.get<ApprovalRecord[]>(`/approvals?sessionId=${id}`),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });
  const events = useQuery({
    queryKey: ['events', id],
    queryFn: () => api.get<EventRecord[]>(`/sessions/${id}/events?afterSeq=0&limit=500`),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const capability = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.get<{ terminal: { available: boolean } }>('/settings/capabilities'),
  });
  const promptContext = useQuery({
    queryKey: [
      'prompt-context',
      session.data?.projectId,
      session.data?.agentId,
      session.data?.taskId,
      promptVariables,
    ],
    queryFn: () => {
      if (!session.data) throw new Error('Session 尚未加载');
      return api.post<ResolvedPromptContextRecord>('/prompt-context/resolve', {
        projectId: session.data.projectId,
        agentId: session.data.agentId,
        ...(session.data.taskId ? { taskId: session.data.taskId } : {}),
        variables: promptVariables,
      });
    },
    enabled: Boolean(session.data),
  });
  const project = projects.data?.find((item) => item.id === session.data?.projectId);
  const agent = agents.data?.find((item) => item.id === session.data?.agentId);
  const activeRun = [...(runs.data ?? [])]
    .reverse()
    .find((run) => ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING'].includes(run.status));

  useEffect(() => {
    if (!id) return;
    return realtime.subscribe(
      `session:${id}`,
      () => {
        void client.invalidateQueries({ queryKey: ['sessions'] });
        void client.invalidateQueries({ queryKey: ['messages', id] });
        void client.invalidateQueries({ queryKey: ['runs', id] });
        void client.invalidateQueries({ queryKey: ['events', id] });
        void client.invalidateQueries({ queryKey: ['approvals', id] });
        void client.invalidateQueries({ queryKey: ['session', id] });
      },
      events.data?.at(-1)?.seq ?? 0,
    );
  }, [client, events.data, id]);

  useEffect(() => {
    if (!mobileInspectorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileInspectorOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileInspectorOpen]);

  if (session.isLoading) return <LoadingState label="正在打开 Coding Workspace" />;
  if (session.error) return <ErrorState error={session.error} />;
  if (!session.data)
    return <EmptyState title="Session 不存在" description="返回会话列表选择可用 Session。" />;

  return (
    <div className="workspace-shell">
      <div className="workspace-contextbar">
        <div className="context-title">
          <Link to="/sessions">会话</Link>
          <ChevronRight size={14} />
          <strong>{session.data.title}</strong>
          <StatusBadge status={session.data.status} />
        </div>
        <div className="context-facts">
          <span>
            <Bot size={14} /> {agent?.name ?? 'Agent 未知'}
          </span>
          <span>
            <GitBranch size={14} /> {session.data.branch || '无 Git'}
          </span>
          <code title={session.data.cwd}>{session.data.cwd}</code>
        </div>
      </div>
      <Tabs.Root value={mobileInspectorOpen ? tab : 'conversation'}>
        <Tabs.List className="workspace-mobile-tabs" aria-label="Workspace 视图">
          <Tabs.Trigger
            value="conversation"
            aria-label="对话"
            onClick={() => setMobileInspectorOpen(false)}
          >
            对话
          </Tabs.Trigger>
          {(
            [
              ['files', '文件'],
              ['diff', 'Diff'],
              ['git', 'Git'],
              ['run', '运行'],
            ] as Array<[InspectorTab, string]>
          ).map(([item, label]) => (
            <Tabs.Trigger
              key={item}
              value={item}
              aria-label={label}
              onClick={() => {
                setTab(item);
                setMobileInspectorOpen(true);
              }}
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <Group orientation="horizontal" className="workspace-panels">
        <Panel
          id="sessions"
          defaultSize="18%"
          minSize="210px"
          maxSize="320px"
          className="workspace-panel session-rail-panel"
        >
          <SessionRail sessions={sessions.data ?? []} currentId={id} />
        </Panel>
        <Separator className="resize-handle" />
        <Panel
          id="conversation"
          defaultSize="49%"
          minSize="360px"
          className="workspace-panel conversation-panel"
        >
          <Conversation
            session={session.data}
            messages={messages.data ?? []}
            events={events.data ?? []}
            approvals={approvals.data ?? []}
            activeRun={activeRun}
          />
        </Panel>
        <Separator className="resize-handle" />
        <Panel
          id="inspector"
          defaultSize="33%"
          minSize="300px"
          className={`workspace-panel inspector-panel ${mobileInspectorOpen ? 'mobile-open' : ''}`}
        >
          <Inspector
            project={project}
            session={session.data}
            tab={tab}
            setTab={setTab}
            selectedFile={selectedFile}
            setSelectedFile={setSelectedFile}
            runs={runs.data ?? []}
          />
        </Panel>
      </Group>
      {mobileInspectorOpen && (
        <button
          className="workspace-drawer-scrim"
          aria-label="关闭检查器"
          onClick={() => setMobileInspectorOpen(false)}
        />
      )}
      <Composer
        session={session.data}
        agent={agent}
        project={project}
        activeRun={activeRun}
        terminalAvailable={capability.data?.terminal.available === true}
        terminalOpen={terminalOpen}
        setTerminalOpen={setTerminalOpen}
        promptContext={promptContext.data}
        promptContextLoading={promptContext.isLoading}
        promptContextError={promptContext.error}
        promptVariables={promptVariables}
        setPromptVariables={setPromptVariables}
      />
      {terminalOpen && capability.data?.terminal.available && (
        <div className="terminal-dock">
          <div>
            <SquareTerminal size={15} />
            <strong>Terminal</strong>
            <code>{session.data.cwd}</code>
          </div>
          <p>Terminal 会使用独立 topic；当前页面暂未开放新建 PTY。</p>
          <Button
            color="gray"
            size="1"
            variant="soft"
            disabled
            title="v0.3 尚未开放浏览器端新建 PTY"
          >
            新建 Terminal
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionRail({ sessions, currentId }: { sessions: SessionRecord[]; currentId: string }) {
  return (
    <div className="session-rail">
      <div className="panel-title">
        <span>Session</span>
        <small>{sessions.length} 个</small>
      </div>
      <div className="session-list">
        {sessions.map((session) => (
          <Link
            className={session.id === currentId ? 'current' : ''}
            to={`/sessions/${session.id}`}
            key={session.id}
          >
            <span className="session-state-dot" />
            <div>
              <strong>{session.title}</strong>
              <code>
                {session.branch || '无 Git'} · {session.cwd.split('/').at(-1)}
              </code>
            </div>
            <StatusBadge status={session.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}

function Conversation({
  session,
  messages,
  events,
  approvals,
  activeRun,
}: {
  session: SessionRecord;
  messages: MessageRecord[];
  events: EventRecord[];
  approvals: ApprovalRecord[];
  activeRun: RunRecord | undefined;
}) {
  const client = useQueryClient();
  const resolve = useMutation({
    mutationFn: ({ id, optionId }: { id: string; optionId: string }) =>
      api.post(`/approvals/${id}/resolve`, { optionId }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['approvals', session.id] });
    },
  });
  const toolEvents = events.filter(
    (event) => event.type.startsWith('tool.') || event.type === 'agent.plan.updated',
  );
  return (
    <div className="conversation">
      <div className="panel-title conversation-title">
        <div>
          <span>对话与执行</span>
          <small>{activeRun ? `Run ${activeRun.id.slice(0, 8)}` : '没有活动 Run'}</small>
        </div>
        {activeRun && <StatusBadge status={activeRun.status} />}
      </div>
      <div className="conversation-scroll">
        {!messages.length && !events.length && (
          <EmptyState
            title="等待第一条指令"
            description="Composer 会固定带上 Agent、Project、cwd、branch 与 PromptOS 上下文。"
          />
        )}
        {messages.map((message) => (
          <article className={`message ${message.role.toLowerCase()}`} key={message.id}>
            <div className="message-meta">
              <span>
                {message.role === 'USER'
                  ? '你'
                  : message.role === 'ASSISTANT'
                    ? 'Agent'
                    : message.role}
              </span>
              <code>#{message.sequence}</code>
            </div>
            <div className="message-body">{message.text || '（无文本内容）'}</div>
          </article>
        ))}
        {toolEvents.map((event) => (
          <article className="tool-card" key={event.id}>
            <div>
              <span className="tool-icon">
                {event.type === 'agent.plan.updated' ? (
                  <ListChecks size={16} />
                ) : (
                  <Wrench size={16} />
                )}
              </span>
              <div>
                <strong>
                  {String(
                    event.payloadJson.title ??
                      (event.type === 'agent.plan.updated' ? 'Agent Plan' : '工具调用'),
                  )}
                </strong>
                <code>{event.type}</code>
              </div>
            </div>
            {Boolean(event.payloadJson.status) && (
              <StatusBadge status={String(event.payloadJson.status).toUpperCase()} />
            )}
          </article>
        ))}
        {approvals.map((approval) => (
          <article className="approval-card" key={approval.id}>
            <div className="approval-heading">
              <span>
                <ShieldCheck size={17} />
              </span>
              <div>
                <small>Agent 原生权限请求</small>
                <strong>{approval.title}</strong>
              </div>
            </div>
            {approval.description && <p>{approval.description}</p>}
            <div className="approval-actions">
              {approval.optionsJson.map(
                (option) =>
                  option.id && (
                    <Button
                      key={option.id}
                      color={/reject|deny/.test(option.kind ?? '') ? 'gray' : 'orange'}
                      size="1"
                      variant={/reject|deny/.test(option.kind ?? '') ? 'soft' : 'solid'}
                      onClick={() => resolve.mutate({ id: approval.id, optionId: option.id! })}
                      disabled={resolve.isPending}
                    >
                      {option.label ?? option.id}
                    </Button>
                  ),
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Inspector({
  project,
  session,
  tab,
  setTab,
  selectedFile,
  setSelectedFile,
  runs,
}: {
  project: ProjectRecord | undefined;
  session: SessionRecord;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  selectedFile: string | undefined;
  setSelectedFile: (path: string) => void;
  runs: RunRecord[];
}) {
  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'files', label: '文件' },
    { id: 'diff', label: 'Diff' },
    { id: 'git', label: 'Git' },
    { id: 'run', label: '运行' },
  ];
  return (
    <div className="inspector">
      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as InspectorTab)}>
        <Tabs.List className="inspector-tabs" aria-label="检查器视图">
          {tabs.map((item) => (
            <Tabs.Trigger key={item.id} value={item.id} aria-label={item.label}>
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <div className="inspector-body">
        {!project ? (
          <EmptyState title="Project 不可用" description="该 Session 关联的 Project 可能已归档。" />
        ) : tab === 'files' ? (
          <FileInspector project={project} selected={selectedFile} onSelect={setSelectedFile} />
        ) : tab === 'diff' ? (
          <DiffInspector project={project} />
        ) : tab === 'git' ? (
          <GitInspector project={project} />
        ) : (
          <RunInspector session={session} runs={runs} />
        )}
      </div>
    </div>
  );
}

function FileInspector({
  project,
  selected,
  onSelect,
}: {
  project: ProjectRecord;
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  const files = useQuery({
    queryKey: ['files', project.id],
    queryFn: () => api.get<FileEntry[]>(`/projects/${project.id}/files?depth=4`),
  });
  const content = useQuery({
    queryKey: ['file', project.id, selected],
    queryFn: () =>
      api.get<{ content: string; path: string }>(
        `/projects/${project.id}/files/content?path=${encodeURIComponent(selected!)}`,
      ),
    enabled: Boolean(selected),
  });
  return (
    <div className="file-inspector">
      <div className="file-tree">
        <div className="mini-heading">
          <Files size={14} /> 文件树
        </div>
        {files.isLoading ? (
          <LoadingState />
        ) : files.error ? (
          <ErrorState error={files.error} />
        ) : (
          <FileNodes entries={files.data ?? []} selected={selected} onSelect={onSelect} />
        )}
      </div>
      <div className="editor-frame">
        {!selected ? (
          <EmptyState title="选择文件" description="文件内容以只读方式显示。" />
        ) : content.isLoading ? (
          <LoadingState />
        ) : content.error ? (
          <ErrorState error={content.error} />
        ) : (
          <Editor
            height="100%"
            path={selected}
            value={content.data?.content ?? ''}
            theme="vs-light"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}

function FileNodes({
  entries,
  selected,
  onSelect,
}: {
  entries: FileEntry[];
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="file-nodes">
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            className={entry.path === selected ? 'selected' : ''}
            disabled={entry.blocked || entry.type !== 'FILE'}
            onClick={() => onSelect(entry.path)}
          >
            {entry.type === 'DIRECTORY' ? <ChevronDown size={13} /> : <FileCode2 size={13} />}
            <span>{entry.name}</span>
            {entry.blocked && <small>已阻止</small>}
          </button>
          {entry.children && (
            <FileNodes entries={entry.children} selected={selected} onSelect={onSelect} />
          )}
        </div>
      ))}
    </div>
  );
}

function DiffInspector({ project }: { project: ProjectRecord }) {
  const diff = useQuery({
    queryKey: ['git-diff', project.id],
    queryFn: () =>
      api.get<{ patch: string; truncated: boolean }>(`/projects/${project.id}/git/diff`),
  });
  return (
    <div className="diff-frame">
      {diff.isLoading ? (
        <LoadingState />
      ) : diff.error ? (
        <ErrorState error={diff.error} />
      ) : !diff.data?.patch ? (
        <EmptyState title="没有未提交 Diff" description="工作区当前没有可展示的差异。" />
      ) : (
        <DiffEditor
          height="100%"
          original=""
          modified={diff.data.patch}
          language="diff"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            renderSideBySide: false,
            fontSize: 12,
          }}
        />
      )}
    </div>
  );
}

function GitInspector({ project }: { project: ProjectRecord }) {
  const status = useQuery({
    queryKey: ['git-status', project.id],
    queryFn: () =>
      api.get<{
        branch?: string;
        headSha?: string;
        clean: boolean;
        entries: Array<{ index: string; worktree: string; path: string }>;
      }>(`/projects/${project.id}/git/status`),
    refetchInterval: 5_000,
  });
  return (
    <div className="git-inspector">
      <div className="git-summary">
        <GitBranch size={16} />
        <div>
          <strong>{status.data?.branch ?? 'Git'}</strong>
          <code>{status.data?.headSha?.slice(0, 12) ?? '无 HEAD'}</code>
        </div>
        {status.data && <StatusBadge status={status.data.clean ? 'READY' : 'UNVERIFIED'} />}
      </div>
      {status.isLoading ? (
        <LoadingState />
      ) : status.error ? (
        <ErrorState error={status.error} />
      ) : status.data?.clean ? (
        <EmptyState title="工作区干净" description="没有 staged、unstaged 或 untracked 文件。" />
      ) : (
        <div className="change-list">
          {status.data?.entries.map((entry) => (
            <div key={`${entry.path}-${entry.index}-${entry.worktree}`}>
              <code>
                {entry.index}
                {entry.worktree}
              </code>
              <span>{entry.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunInspector({ session, runs }: { session: SessionRecord; runs: RunRecord[] }) {
  return (
    <div className="run-inspector">
      <div className="run-context">
        <span>Agent</span>
        <strong>{session.agentId.slice(0, 8)}</strong>
        <span>模型</span>
        <strong>{session.model || 'Agent 默认'}</strong>
        <span>模式</span>
        <strong>{session.mode || 'Agent 默认'}</strong>
        <span>cwd</span>
        <code>{session.cwd}</code>
      </div>
      <div className="run-history">
        {[...runs].reverse().map((run) => (
          <div key={run.id}>
            <span className="run-dot" />
            <div>
              <strong>Run {run.id.slice(0, 8)}</strong>
              <code>
                {run.gitBeforeSha?.slice(0, 8) ?? '—'} → {run.gitAfterSha?.slice(0, 8) ?? '—'}
              </code>
            </div>
            <StatusBadge status={run.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Composer({
  session,
  agent,
  project,
  activeRun,
  terminalAvailable,
  terminalOpen,
  setTerminalOpen,
  promptContext,
  promptContextLoading,
  promptContextError,
  promptVariables,
  setPromptVariables,
}: {
  session: SessionRecord;
  agent: AgentRecord | undefined;
  project: ProjectRecord | undefined;
  activeRun: RunRecord | undefined;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  promptContext: ResolvedPromptContextRecord | undefined;
  promptContextLoading: boolean;
  promptContextError: Error | null;
  promptVariables: Record<string, unknown>;
  setPromptVariables: (variables: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [variablesDraft, setVariablesDraft] = useState(() =>
    JSON.stringify(promptVariables, null, 2),
  );
  const [variablesError, setVariablesError] = useState<string>();
  const client = useQueryClient();
  const send = useMutation({
    mutationFn: () => api.post(`/sessions/${session.id}/runs`, { text, promptVariables }),
    onSuccess: () => {
      setText('');
      void client.invalidateQueries({ queryKey: ['runs', session.id] });
    },
  });
  const stop = useMutation({
    mutationFn: () => api.post(`/sessions/${session.id}/runs/${activeRun!.id}/cancel`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['runs', session.id] }),
  });
  const configuration = (agent?.capabilitiesJson.configuration ?? {}) as Record<string, boolean>;
  const contextBlocked =
    promptContextLoading || Boolean(promptContextError) || promptContext?.ready === false;
  return (
    <div className="composer">
      <div className="composer-context">
        <span>
          <Bot size={13} /> {agent?.name ?? 'Agent'}
        </span>
        {configuration.models && (
          <span>
            模型 <strong>{session.model || agent?.defaultModel || '默认'}</strong>
          </span>
        )}
        {configuration.modes && (
          <span>
            模式 <strong>{session.mode || agent?.defaultMode || '默认'}</strong>
          </span>
        )}
        <span>
          Project <strong>{project?.name ?? '未知'}</strong>
        </span>
        <span className="cwd-chip">
          cwd <code>{session.cwd}</code>
        </span>
        <span>
          <GitBranch size={13} /> {session.branch || '无 Git'}
        </span>
        <button
          className={contextOpen ? 'active' : ''}
          onClick={() => setContextOpen(!contextOpen)}
        >
          <Braces size={13} /> PromptOS{' '}
          <strong>
            {promptContextLoading
              ? '解析中'
              : promptContextError
                ? '异常'
                : promptContext?.ready === false
                  ? `缺 ${promptContext.missingVariables.length} 项变量`
                  : `${promptContext?.items.length ?? 0} 项`}
          </strong>
        </button>
        <span>
          Skill <strong>自动</strong>
        </span>
        {terminalAvailable && (
          <button
            className={terminalOpen ? 'active' : ''}
            onClick={() => setTerminalOpen(!terminalOpen)}
          >
            <SquareTerminal size={13} /> Terminal
          </button>
        )}
      </div>
      {contextOpen && (
        <div className="composer-context-preview">
          <div className="context-preview-heading">
            <div>
              <strong>PromptOS 上下文预览</strong>
              <span>发送 Run 前解析，版本、标签与 content hash 会写入来源记录。</span>
            </div>
            <span className={promptContext?.ready === false ? 'missing' : 'ready'}>
              {promptContext?.ready === false ? '缺少必填变量' : '已就绪'}
            </span>
          </div>
          <div className="composer-context-grid">
            <div className="composer-provenance">
              {!promptContext?.items.length ? (
                <p>当前 Project、Agent、Task 没有生效的绑定。</p>
              ) : (
                promptContext.items.map((item) => (
                  <div key={item.bindingId}>
                    <span>{item.slot}</span>
                    <code>
                      {item.promptKey}@{item.label ?? `v${item.version}`}
                    </code>
                    <small>
                      {item.targetType} · v{item.version} · {item.contentHash.slice(0, 10)}
                    </small>
                  </div>
                ))
              )}
            </div>
            <label>
              变量 JSON
              <textarea
                className="mono"
                value={variablesDraft}
                onChange={(event) => setVariablesDraft(event.target.value)}
                rows={4}
              />
              <Button
                color="gray"
                size="1"
                variant="soft"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(variablesDraft) as unknown;
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                      throw new Error();
                    setVariablesError(undefined);
                    setPromptVariables(parsed as Record<string, unknown>);
                  } catch {
                    setVariablesError('变量必须是合法 JSON object');
                  }
                }}
              >
                应用并重新解析
              </Button>
              {(variablesError || promptContext?.missingVariables.length) && (
                <small className="context-variable-error">
                  {variablesError ?? `缺少：${promptContext?.missingVariables.join('、')}`}
                </small>
              )}
            </label>
          </div>
        </div>
      )}
      <div className="composer-input">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="给 Agent 发送工程指令…"
          rows={2}
          disabled={Boolean(activeRun)}
        />
        {activeRun ? (
          <IconButton
            className="send-button stop"
            color="red"
            onClick={() => stop.mutate()}
            aria-label="停止 Run"
          >
            <CircleStop size={18} />
          </IconButton>
        ) : (
          <IconButton
            className="send-button"
            disabled={!text.trim() || send.isPending || contextBlocked || Boolean(variablesError)}
            onClick={() => send.mutate()}
            aria-label="发送"
          >
            <Send size={18} />
          </IconButton>
        )}
      </div>
      {send.error && <span className="composer-error">{send.error.message}</span>}
    </div>
  );
}
