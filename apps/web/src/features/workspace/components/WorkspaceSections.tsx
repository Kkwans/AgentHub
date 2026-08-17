import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Braces,
  Button,
  ChevronDown,
  CircleStop,
  FileCode2,
  Files,
  GitBranch,
  GitCompareArrows,
  IconButton,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Tabs,
  Wrench,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../../components/Common';
import { SafeDiffEditor } from '../../../components/SafeDiffEditor';
import {
  ApiError,
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
} from '../../../lib/api';
import {
  labelAgentEventType,
  labelApprovalStatus,
  labelPromptBindingSlot,
  labelPromptBindingTarget,
  presentAgentMessage,
  resolveWorkspaceRunState,
  WORKSPACE_RUN_STATE_COPY,
} from '../../../presentation/domain-labels';

type InspectorTab = 'files' | 'diff' | 'git' | 'run';

type QueryState<T> = {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  refetch: () => unknown;
};

export function SessionRail({
  sessions,
  currentId,
}: {
  sessions: QueryState<SessionRecord[]>;
  currentId: string;
}) {
  return (
    <div className="session-rail">
      <div className="panel-title">
        <span>Session</span>
        <small>{sessions.data?.length ?? 0} 个</small>
      </div>
      <div className="session-list">
        {sessions.isLoading ? (
          <LoadingState label="正在读取 Session" />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} retry={() => sessions.refetch()} />
        ) : (
          (sessions.data ?? []).map((session) => (
            <Link
              className={session.id === currentId ? 'current' : ''}
              to={`/sessions/${session.id}`}
              key={session.id}
            >
              <span
                className={`session-state-dot session-state-${resolveWorkspaceRunState(session.status).toLowerCase()}`}
                aria-hidden="true"
              />
              <div>
                <strong>{session.title}</strong>
                <code>
                  {session.branch || '无 Git'} · {session.cwd.split('/').at(-1)}
                </code>
              </div>
              <StatusBadge status={session.status} />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

export function Conversation({
  session,
  messages,
  events,
  approvals,
  activeRun,
  latestRunStatus,
}: {
  session: SessionRecord;
  messages: QueryState<MessageRecord[]>;
  events: QueryState<EventRecord[]>;
  approvals: QueryState<ApprovalRecord[]>;
  activeRun: RunRecord | undefined;
  latestRunStatus?: string | undefined;
}) {
  const client = useQueryClient();
  const [approvalFeedback, setApprovalFeedback] = useState<string>();
  const resolve = useMutation({
    mutationFn: ({ id, optionId }: { id: string; optionId: string }) =>
      api.post<ApprovalRecord>(`/approvals/${id}/resolve`, { optionId }),
    onMutate: () => setApprovalFeedback(undefined),
    onSuccess: (approval) => {
      setApprovalFeedback(
        approval.deliveryState === 'UNKNOWN'
          ? '决定已保存，但 Agent 是否收到仍无法确认。'
          : approval.deliveryState === 'DEAD'
            ? '决定已保存，但没有发送给 Agent。'
            : '决定已安全保存，正在确认 Agent 接收状态。',
      );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['approvals', session.id] });
      void client.invalidateQueries({ queryKey: ['runs', session.id] });
      void client.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });
  const toolEvents = (events.data ?? []).filter(
    (event) =>
      event.payloadJson.ignored !== true &&
      (event.type.startsWith('tool.') || event.type === 'agent.plan.updated'),
  );
  const showEmpty =
    !messages.isLoading &&
    !events.isLoading &&
    !approvals.isLoading &&
    !messages.error &&
    !events.error &&
    !approvals.error &&
    !messages.data?.length &&
    !events.data?.length;
  return (
    <div className="conversation">
      <div className="panel-title conversation-title">
        <div>
          <span>对话与执行</span>
          <small>{activeRun ? '当前 Run' : '没有活动 Run'}</small>
        </div>
        {activeRun && <StatusBadge status={activeRun.status} />}
      </div>
      <div
        className="conversation-scroll"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <RunStateBanner
          sessionStatus={session.status}
          activeRunStatus={activeRun?.status}
          latestRunStatus={latestRunStatus}
        />
        {approvals.isLoading && <LoadingState label="正在读取 Approval" />}
        {approvals.error && (
          <ErrorState error={approvals.error} retry={() => approvals.refetch()} />
        )}
        {approvalFeedback && (
          <div className="workspace-query-status" role="status" aria-live="polite">
            {approvalFeedback}
          </div>
        )}
        {messages.isLoading && <LoadingState label="正在读取消息" />}
        {messages.error && <ErrorState error={messages.error} retry={() => messages.refetch()} />}
        {events.isLoading && <LoadingState label="正在读取工具事件" />}
        {events.error && <ErrorState error={events.error} retry={() => events.refetch()} />}
        {showEmpty && (
          <EmptyState
            title="等待第一条指令"
            description="Composer 会固定带上 Agent、Project、cwd、branch 与 PromptOS 上下文。"
          />
        )}
        {(messages.data ?? []).map((message) => {
          const presentation = presentAgentMessage(message.text);
          return (
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
              {presentation.kind === 'TRANSPORT_ERROR' ? (
                <div className="message-body message-body-error">
                  <strong>{presentation.title}</strong>
                  <p>{presentation.text}</p>
                  <details className="message-debug">
                    <summary>显示脱敏诊断</summary>
                    <pre>{presentation.debug}</pre>
                  </details>
                </div>
              ) : (
                <div className="message-body">{presentation.text}</div>
              )}
            </article>
          );
        })}
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
                      (event.type === 'agent.plan.updated' ? 'Agent 执行计划' : '工具调用'),
                  )}
                </strong>
                <span className="event-label">{labelAgentEventType(event.type)}</span>
              </div>
            </div>
            {Boolean(event.payloadJson.status) && (
              <StatusBadge status={String(event.payloadJson.status).toUpperCase()} />
            )}
          </article>
        ))}
        {(approvals.data ?? []).map((approval) => {
          const awaitingDecision = approval.status === 'PENDING';
          const deliveryInProgress = ['QUEUED', 'CLAIMED', 'DISPATCHING', 'RETRY_WAIT'].includes(
            approval.deliveryState ?? '',
          );
          const deliveryUnconfirmed = approval.deliveryState === 'UNKNOWN';
          const deliveryAborted = approval.deliveryState === 'DEAD';
          const selectedOption = approval.optionsJson.find(
            (option) => option.id === approval.selectedOptionId,
          );
          const deliveryStateLabel =
            approval.deliveryState === 'UNKNOWN'
              ? '状态无法确认'
              : approval.deliveryState === 'DEAD'
                ? '未发送给 Agent'
                : approval.deliveryState === 'DELIVERED'
                  ? 'Agent 已接收'
                  : approval.deliveryState
                    ? '正在处理'
                    : '尚未发送';
          const deliveryFailureCopy =
            approval.deliveryState === 'UNKNOWN'
              ? 'Agent 没有在限定时间内确认，系统不会自动重发，避免同一权限操作执行两次。'
              : '系统未能将这个决定交给 Agent。请恢复 Session 后重新开始。';
          return (
            <article
              className={`approval-card${deliveryUnconfirmed || deliveryAborted ? ' approval-card-attention' : ''}`}
              key={approval.id}
            >
              <div className="approval-heading">
                <span>
                  {deliveryInProgress ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : deliveryUnconfirmed || deliveryAborted ? (
                    <AlertTriangle size={17} />
                  ) : (
                    <ShieldCheck size={17} />
                  )}
                </span>
                <div className="approval-heading-copy">
                  <small className="approval-kicker">
                    {awaitingDecision ? 'Agent 请求' : deliveryInProgress ? '正在处理' : '投递结果'}
                  </small>
                  <strong>{approval.title}</strong>
                </div>
              </div>
              {approval.description && (
                <div className="approval-impact">
                  <span>影响</span>
                  <p>{approval.description}</p>
                </div>
              )}
              {awaitingDecision && (
                <>
                  <span className="approval-options-label">可选操作</span>
                  {approval.optionsJson.some((option) => option.id) ? (
                    <div
                      className="approval-actions"
                      aria-label="合法操作选项"
                      aria-busy={resolve.isPending && resolve.variables?.id === approval.id}
                    >
                      {approval.optionsJson.map(
                        (option) =>
                          option.id && (
                            <Button
                              key={option.id}
                              color={
                                /reject|deny|refuse/i.test(
                                  `${option.kind ?? ''} ${option.id} ${option.label ?? ''}`,
                                )
                                  ? 'gray'
                                  : 'orange'
                              }
                              size="1"
                              variant={
                                /reject|deny|refuse/i.test(
                                  `${option.kind ?? ''} ${option.id} ${option.label ?? ''}`,
                                )
                                  ? 'soft'
                                  : 'solid'
                              }
                              onClick={() =>
                                resolve.mutate({ id: approval.id, optionId: option.id! })
                              }
                              disabled={resolve.isPending}
                            >
                              {option.label ?? option.id}
                            </Button>
                          ),
                      )}
                    </div>
                  ) : (
                    <div className="approval-no-options" role="alert">
                      Agent 没有提供可执行选项，请返回 Session 列表重新开始。
                    </div>
                  )}
                </>
              )}
              {deliveryInProgress && (
                <div className="approval-delivery-status" role="status" aria-live="polite">
                  <strong>决定已保存</strong>
                  <span>
                    已选择“{selectedOption?.label ?? '已记录选项'}”，正在等待 Agent
                    确认接收，请勿重复操作。
                  </span>
                </div>
              )}
              {deliveryUnconfirmed && (
                <div
                  className="approval-delivery-status approval-delivery-status-danger"
                  role="alert"
                >
                  <strong>无法确认 Agent 是否收到</strong>
                  <span>{deliveryFailureCopy}</span>
                  <Link to="/sessions">前往 Session 列表恢复或重新开始</Link>
                </div>
              )}
              {deliveryAborted && (
                <div
                  className="approval-delivery-status approval-delivery-status-danger"
                  role="alert"
                >
                  <strong>决定没有发送给 Agent</strong>
                  <span>{deliveryFailureCopy}</span>
                  <Link to="/sessions">前往 Session 列表处理</Link>
                </div>
              )}
              {resolve.variables?.id === approval.id && resolve.isError && (
                <div className="workspace-query-error" role="alert">
                  <span>{resolve.error?.message ?? 'Approval 提交失败。'}</span>
                  {!(
                    resolve.error instanceof ApiError &&
                    resolve.error.code === 'APPROVAL_DECISION_CONFLICT'
                  ) && (
                    <Button
                      color="red"
                      size="1"
                      variant="soft"
                      disabled={resolve.isPending}
                      onClick={() => {
                        const variables = resolve.variables;
                        if (variables) resolve.mutate(variables);
                      }}
                    >
                      重试此选项
                    </Button>
                  )}
                </div>
              )}
              <details className="approval-debug">
                <summary>显示诊断信息</summary>
                <dl>
                  <div>
                    <dt>Approval</dt>
                    <dd>
                      <code>{approval.id}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{labelApprovalStatus(approval.status)}</dd>
                  </div>
                  <div>
                    <dt>投递</dt>
                    <dd>{deliveryStateLabel}</dd>
                  </div>
                  {approval.deliveryErrorCode && (
                    <div>
                      <dt>错误码</dt>
                      <dd>
                        <code>{approval.deliveryErrorCode}</code>
                      </dd>
                    </div>
                  )}
                  {approval.deliveryErrorMessage && (
                    <div>
                      <dt>原始信息</dt>
                      <dd>{approval.deliveryErrorMessage}</dd>
                    </div>
                  )}
                </dl>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function RunStateBanner({
  sessionStatus,
  activeRunStatus,
  latestRunStatus,
}: {
  sessionStatus: string | null | undefined;
  activeRunStatus?: string | null | undefined;
  latestRunStatus?: string | null | undefined;
}) {
  const state = resolveWorkspaceRunState(sessionStatus, activeRunStatus, latestRunStatus);
  const copy = WORKSPACE_RUN_STATE_COPY[state];
  const showLink = state === 'DISCONNECTED' || state === 'CLOSED';
  return (
    <section
      className={`run-state-banner run-state-${state.toLowerCase()}`}
      aria-label={`当前运行状态：${copy.title}`}
      aria-live="polite"
    >
      <span className="run-state-marker" aria-hidden="true" />
      <div>
        <strong>{copy.title}</strong>
        <span>{copy.description}</span>
      </div>
      {showLink && (
        <Link className="run-state-link" to="/sessions">
          返回 Session 列表
        </Link>
      )}
    </section>
  );
}

export function Inspector({
  project,
  projects,
  session,
  tab,
  setTab,
  selectedFile,
  setSelectedFile,
  agent,
  runs,
}: {
  project: ProjectRecord | undefined;
  projects: QueryState<ProjectRecord[]>;
  session: SessionRecord;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  selectedFile: string | undefined;
  setSelectedFile: (path: string) => void;
  agent: AgentRecord | undefined;
  runs: QueryState<RunRecord[]>;
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
        {projects.isLoading ? (
          <LoadingState label="正在读取 Project" />
        ) : projects.error ? (
          <ErrorState error={projects.error} retry={() => projects.refetch()} />
        ) : !project ? (
          <EmptyState title="Project 不可用" description="该 Session 关联的 Project 可能已归档。" />
        ) : tab === 'files' ? (
          <FileInspector project={project} selected={selectedFile} onSelect={setSelectedFile} />
        ) : tab === 'diff' ? (
          <DiffInspector project={project} />
        ) : tab === 'git' ? (
          <GitInspector project={project} />
        ) : (
          <RunInspector agent={agent} session={session} runs={runs} />
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
          <ErrorState error={files.error} retry={() => files.refetch()} />
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
          <ErrorState error={content.error} retry={() => content.refetch()} />
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
        <ErrorState error={diff.error} retry={() => diff.refetch()} />
      ) : !diff.data?.patch ? (
        <EmptyState title="没有未提交 Diff" description="工作区当前没有可展示的差异。" />
      ) : (
        <SafeDiffEditor
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
  type GitView = 'changes' | 'diff' | 'history' | 'branches';
  const client = useQueryClient();
  const [view, setView] = useState<GitView>('changes');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [stagedDiff, setStagedDiff] = useState(false);
  const [commitReceipt, setCommitReceipt] = useState<string>();
  const status = useQuery({
    queryKey: ['git-status', project.id],
    queryFn: () =>
      api.get<{
        branch?: string;
        upstream?: string;
        ahead?: number;
        behind?: number;
        headSha?: string;
        clean: boolean;
        entries: Array<{
          index: string;
          worktree: string;
          path: string;
          originalPath?: string;
        }>;
      }>(`/projects/${project.id}/git/status`),
    refetchInterval: 5_000,
  });
  const diff = useQuery({
    queryKey: ['git-diff', project.id, stagedDiff],
    queryFn: () =>
      api.get<{ patch: string; truncated: boolean; staged: boolean }>(
        `/projects/${project.id}/git/diff?staged=${stagedDiff}`,
      ),
    enabled: view === 'diff',
  });
  const commits = useQuery({
    queryKey: ['git-commits', project.id],
    queryFn: () =>
      api.get<
        Array<{
          sha: string;
          shortSha: string;
          authorName: string;
          authoredAt: string;
          subject: string;
        }>
      >(`/projects/${project.id}/git/commits?limit=30`),
    enabled: view === 'history',
  });
  const branches = useQuery({
    queryKey: ['git-branches', project.id],
    queryFn: () =>
      api.get<
        Array<{
          name: string;
          sha: string;
          current: boolean;
          upstream?: string;
          committedAt: string;
        }>
      >(`/projects/${project.id}/git/branches`),
    enabled: view === 'branches',
  });
  const commit = useMutation({
    mutationFn: () =>
      api.post<{ beforeSha?: string; sha?: string; output: string }>(
        `/projects/${project.id}/git/commit`,
        { mode: 'SELECTED', paths: selectedPaths, message: commitMessage.trim() },
      ),
    onSuccess: async (receipt) => {
      setSelectedPaths([]);
      setCommitMessage('');
      setCommitReceipt(receipt.sha ? `提交完成 · ${receipt.sha.slice(0, 12)}` : '提交完成');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['git-status', project.id] }),
        client.invalidateQueries({ queryKey: ['git-diff', project.id] }),
        client.invalidateQueries({ queryKey: ['git-commits', project.id] }),
        client.invalidateQueries({ queryKey: ['git-branches', project.id] }),
      ]);
    },
  });

  useEffect(() => {
    if (!status.data) return;
    const available = new Set(status.data.entries.map((entry) => entry.path));
    setSelectedPaths((current) => current.filter((path) => available.has(path)));
  }, [status.data]);

  const togglePath = (path: string) => {
    setCommitReceipt(undefined);
    setSelectedPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  };

  const refetchCurrentView = () => {
    if (view === 'diff') void diff.refetch();
    else if (view === 'history') void commits.refetch();
    else if (view === 'branches') void branches.refetch();
    else void status.refetch();
  };

  return (
    <div className="git-inspector">
      <div className="git-summary">
        <GitBranch size={16} />
        <div>
          <strong>{status.data?.branch ?? 'Git'}</strong>
          <code>{status.data?.headSha?.slice(0, 12) ?? '无 HEAD'}</code>
          {status.data?.upstream && (
            <small>
              {status.data.upstream}
              {status.data.ahead ? ` · ahead ${status.data.ahead}` : ''}
              {status.data.behind ? ` · behind ${status.data.behind}` : ''}
            </small>
          )}
        </div>
        {status.data && <StatusBadge status={status.data.clean ? 'READY' : 'UNVERIFIED'} />}
      </div>

      <div className="git-viewbar">
        <Tabs.Root value={view} onValueChange={(value) => setView(value as GitView)}>
          <Tabs.List aria-label="Git 工作区视图">
            <Tabs.Trigger value="changes" aria-label="变更">
              变更
            </Tabs.Trigger>
            <Tabs.Trigger value="diff" aria-label="Diff">
              Diff
            </Tabs.Trigger>
            <Tabs.Trigger value="history" aria-label="历史">
              历史
            </Tabs.Trigger>
            <Tabs.Trigger value="branches" aria-label="分支">
              分支
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
        <IconButton
          type="button"
          size="1"
          variant="ghost"
          aria-label="刷新 Git 数据"
          onClick={refetchCurrentView}
        >
          <RefreshCw size={15} />
        </IconButton>
      </div>

      {commitReceipt && (
        <p className="git-commit-receipt" role="status">
          {commitReceipt}
        </p>
      )}

      {view === 'changes' &&
        (status.isLoading ? (
          <LoadingState label="正在读取 Git 状态" />
        ) : status.error ? (
          <ErrorState error={status.error} retry={() => status.refetch()} />
        ) : status.data?.clean ? (
          <EmptyState title="工作区干净" description="没有 staged、unstaged 或 untracked 文件。" />
        ) : (
          <>
            <div className="git-selection-heading">
              <span>{status.data?.entries.length ?? 0} 个变更</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedPaths(
                    selectedPaths.length === status.data?.entries.length
                      ? []
                      : (status.data?.entries.map((entry) => entry.path) ?? []),
                  )
                }
              >
                {selectedPaths.length === status.data?.entries.length ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="change-list git-change-list">
              {status.data?.entries.map((entry) => (
                <label key={`${entry.path}-${entry.index}-${entry.worktree}`}>
                  <input
                    type="checkbox"
                    checked={selectedPaths.includes(entry.path)}
                    onChange={() => togglePath(entry.path)}
                    aria-label={`选择 ${entry.path}`}
                  />
                  <code>
                    {entry.index}
                    {entry.worktree}
                  </code>
                  <span title={entry.path}>{entry.path}</span>
                  <small>{describeGitChange(entry.index, entry.worktree)}</small>
                </label>
              ))}
            </div>
            <form
              className="git-commit-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (selectedPaths.length && commitMessage.trim()) commit.mutate();
              }}
            >
              <label>
                <span>提交说明</span>
                <textarea
                  value={commitMessage}
                  maxLength={10_000}
                  rows={3}
                  placeholder="说明这次变更解决了什么"
                  onChange={(event) => {
                    setCommitReceipt(undefined);
                    commit.reset();
                    setCommitMessage(event.target.value);
                  }}
                />
              </label>
              <Button
                type="submit"
                size="2"
                disabled={!selectedPaths.length || !commitMessage.trim() || commit.isPending}
              >
                <GitCompareArrows size={16} />
                {commit.isPending ? '正在提交…' : `提交所选文件 (${selectedPaths.length})`}
              </Button>
              <small>只提交勾选文件，不会混入其他已暂存变更。</small>
              {commit.error && (
                <div className="workspace-query-error" role="alert">
                  <span>{commit.error.message}</span>
                  <button type="button" onClick={() => commit.mutate()}>
                    重试提交
                  </button>
                </div>
              )}
            </form>
          </>
        ))}

      {view === 'diff' && (
        <div className="git-view-content git-diff-view">
          <label className="git-diff-toggle">
            <input
              type="checkbox"
              checked={stagedDiff}
              onChange={(event) => setStagedDiff(event.target.checked)}
            />
            查看 staged Diff
          </label>
          {diff.isLoading ? (
            <LoadingState label="正在读取 Diff" />
          ) : diff.error ? (
            <ErrorState error={diff.error} retry={() => diff.refetch()} />
          ) : !diff.data?.patch ? (
            <EmptyState
              title={stagedDiff ? '没有 staged Diff' : '没有未暂存 Diff'}
              description="切换范围或返回变更列表查看当前状态。"
            />
          ) : (
            <pre>{diff.data.patch}</pre>
          )}
          {diff.data?.truncated && <small>Diff 过大，当前仅显示前 4 MiB。</small>}
        </div>
      )}

      {view === 'history' && (
        <div className="git-view-content">
          {commits.isLoading ? (
            <LoadingState label="正在读取提交历史" />
          ) : commits.error ? (
            <ErrorState error={commits.error} retry={() => commits.refetch()} />
          ) : !commits.data?.length ? (
            <EmptyState title="还没有提交" description="这个 Git 仓库尚无提交历史。" />
          ) : (
            <div className="git-history-list">
              {commits.data.map((item) => (
                <article key={item.sha}>
                  <strong>{item.subject}</strong>
                  <span>
                    <code>{item.shortSha}</code> · {item.authorName}
                  </span>
                  <time dateTime={item.authoredAt}>{formatGitTime(item.authoredAt)}</time>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'branches' && (
        <div className="git-view-content">
          {branches.isLoading ? (
            <LoadingState label="正在读取分支" />
          ) : branches.error ? (
            <ErrorState error={branches.error} retry={() => branches.refetch()} />
          ) : !branches.data?.length ? (
            <EmptyState title="没有本地分支" description="这个 Git 仓库尚无可展示的分支。" />
          ) : (
            <div className="git-branch-list">
              {branches.data.map((item) => (
                <article key={item.name} className={item.current ? 'current' : undefined}>
                  <GitBranch size={15} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.upstream ?? '未跟踪远端分支'}</span>
                  </div>
                  <code>{item.sha.slice(0, 8)}</code>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function describeGitChange(index: string, worktree: string): string {
  if (index === '?' && worktree === '?') return '未跟踪';
  if (index !== ' ' && worktree !== ' ') return '已暂存 + 未暂存';
  if (index !== ' ') return '已暂存';
  return '未暂存';
}

function formatGitTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString('zh-CN', { hour12: false });
}

function RunInspector({
  agent,
  session,
  runs,
}: {
  agent: AgentRecord | undefined;
  session: SessionRecord;
  runs: QueryState<RunRecord[]>;
}) {
  const recentRuns = [...(runs.data ?? [])].reverse();
  return (
    <div className="run-inspector">
      <div className="run-context">
        <span>Agent</span>
        <strong>{agent?.name ?? '当前 Agent'}</strong>
        <span>模型</span>
        <strong>{session.model || 'Agent 默认'}</strong>
        <span>模式</span>
        <strong>{session.mode || 'Agent 默认'}</strong>
        <span>cwd</span>
        <code>{session.cwd}</code>
      </div>
      <div className="run-history">
        {runs.isLoading ? (
          <LoadingState label="正在读取 Run" />
        ) : runs.error ? (
          <ErrorState error={runs.error} retry={() => runs.refetch()} />
        ) : (
          recentRuns.map((run, index) => (
            <div key={run.id}>
              <span className="run-dot" />
              <div>
                <strong>第 {recentRuns.length - index} 次 Run</strong>
                <code>
                  {run.gitBeforeSha?.slice(0, 8) ?? '—'} → {run.gitAfterSha?.slice(0, 8) ?? '—'}
                </code>
              </div>
              <StatusBadge status={run.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function Composer({
  session,
  agent,
  project,
  activeRun,
  promptContext,
  promptContextLoading,
  promptContextError,
  promptContextRetry,
  promptVariables,
  setPromptVariables,
}: {
  session: SessionRecord;
  agent: AgentRecord | undefined;
  project: ProjectRecord | undefined;
  activeRun: RunRecord | undefined;
  promptContext: ResolvedPromptContextRecord | undefined;
  promptContextLoading: boolean;
  promptContextError: Error | null;
  promptContextRetry: () => unknown;
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
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['runs', session.id] });
      void client.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });
  const configuration = (agent?.capabilitiesJson.configuration ?? {}) as Record<string, boolean>;
  const sessionLocked = session.status !== 'READY';
  const contextBlocked =
    promptContextLoading ||
    Boolean(promptContextError) ||
    !promptContext ||
    Boolean(variablesError) ||
    promptContext.ready === false;
  const contextStatus = promptContextLoading
    ? { label: '解析中', kind: 'loading' }
    : variablesError
      ? { label: '解析失败', kind: 'error' }
      : promptContextError
        ? { label: '服务失败', kind: 'error' }
        : !promptContext
          ? { label: '等待解析', kind: 'loading' }
          : promptContext.ready === false
            ? { label: `缺 ${promptContext.missingVariables.length} 项变量`, kind: 'missing' }
            : promptContext.items.length === 0
              ? { label: '无绑定', kind: 'empty' }
              : { label: `${promptContext.items.length} 项`, kind: 'ready' };
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
          aria-expanded={contextOpen}
        >
          <Braces size={13} /> PromptOS <strong>{contextStatus.label}</strong>
        </button>
        <span>
          Skill <strong>自动</strong>
        </span>
      </div>
      {contextOpen && (
        <div className="composer-context-preview">
          <div className="context-preview-heading">
            <div>
              <strong>PromptOS 上下文预览</strong>
              <span>发送 Run 前解析，版本、标签与 content hash 会写入来源记录。</span>
            </div>
            <span className={contextStatus.kind}>{contextStatus.label}</span>
          </div>
          {promptContextLoading ? (
            <LoadingState label="正在解析 PromptOS 上下文" />
          ) : promptContextError ? (
            <div className="prompt-context-error">
              <ErrorState error={promptContextError} />
              <Button color="red" size="1" variant="soft" onClick={() => promptContextRetry()}>
                重新解析
              </Button>
            </div>
          ) : (
            <div className="composer-context-grid">
              <div className="composer-provenance">
                {!promptContext?.items.length ? (
                  <p>当前 Project、Agent、Task 没有生效的绑定。</p>
                ) : (
                  promptContext.items.map((item) => (
                    <div key={item.bindingId}>
                      <span>{labelPromptBindingSlot(item.slot)}</span>
                      <code>
                        {item.promptKey}@{item.label ?? `v${item.version}`}
                      </code>
                      <small>
                        {labelPromptBindingTarget(item.targetType)} · v{item.version} ·{' '}
                        {item.contentHash.slice(0, 10)}
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
                {variablesError && (
                  <small className="context-variable-error" role="alert">
                    {variablesError}
                  </small>
                )}
                {promptContext?.ready === false && !variablesError && (
                  <small className="context-variable-error">
                    缺少：{promptContext.missingVariables.join('、')}
                  </small>
                )}
              </label>
            </div>
          )}
        </div>
      )}
      <div className="composer-input">
        <textarea
          aria-label="给 Agent 发送工程指令"
          autoComplete="off"
          name="message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="给 Agent 发送工程指令…"
          rows={2}
          disabled={Boolean(activeRun) || sessionLocked}
        />
        {activeRun ? (
          <IconButton
            className="send-button stop"
            color="red"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            aria-label={stop.isPending ? '正在停止 Run' : '停止 Run'}
          >
            <CircleStop size={18} />
          </IconButton>
        ) : (
          <IconButton
            className="send-button"
            disabled={
              !text.trim() ||
              send.isPending ||
              contextBlocked ||
              Boolean(variablesError) ||
              sessionLocked
            }
            onClick={() => send.mutate()}
            aria-label="发送"
          >
            <Send size={18} />
          </IconButton>
        )}
      </div>
      {stop.error && (
        <div className="workspace-query-error" role="alert">
          <span>停止 Run 失败：{stop.error.message}</span>
          <Button
            color="red"
            size="1"
            variant="soft"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            重试停止
          </Button>
        </div>
      )}
      {send.error && (
        <span className="composer-error" role="alert">
          {send.error.message}
        </span>
      )}
      {sessionLocked && !activeRun && (
        <span className="composer-hint" role="status">
          {session.status === 'CLOSED'
            ? 'Session 已关闭，无法继续发送指令。'
            : session.status === 'DISCONNECTED'
              ? 'Agent 连接已中断，请先恢复 Session。'
              : 'Session 正在准备中，请稍候。'}
        </span>
      )}
    </div>
  );
}
