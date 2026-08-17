import { useCallback, useEffect, useState } from 'react';
import { Bot, ChevronRight, GitBranch, Tabs, X } from '@agenthub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/Common';
import {
  api,
  type AgentRecord,
  type ApprovalRecord,
  type EventRecord,
  type MessageRecord,
  type ProjectRecord,
  type ResolvedPromptContextRecord,
  type RunRecord,
  type SessionConfigurationRecord,
  type SessionRecord,
} from '../lib/api';
import '../lib/monaco';
import { realtime } from '../lib/realtime';
import '../styles/v3-workspace.css';
import {
  Composer,
  Conversation,
  Inspector,
  SessionRail,
} from '../features/workspace/components/WorkspaceSections';
import { TerminalDock } from '../features/workspace/components/TerminalDock';

type InspectorTab = 'files' | 'diff' | 'git' | 'run';

const EVENT_PAGE_SIZE = 500;

export async function fetchSessionEventPages(
  sessionId: string,
  afterSeq = 0,
): Promise<EventRecord[]> {
  const collected: EventRecord[] = [];
  let cursor = afterSeq;
  while (true) {
    const page = await api.get<EventRecord[]>(
      `/sessions/${sessionId}/events?afterSeq=${cursor}&limit=${EVENT_PAGE_SIZE}`,
    );
    const next = page.filter((event) => event.seq > cursor).sort((a, b) => a.seq - b.seq);
    collected.push(...next);
    const nextCursor = next.at(-1)?.seq ?? cursor;
    if (page.length < EVENT_PAGE_SIZE || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return collected;
}

export function mergeSessionEvents(
  existing: EventRecord[],
  incoming: EventRecord[],
): EventRecord[] {
  const bySeq = new Map<number, EventRecord>();
  for (const event of [...existing, ...incoming]) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function WorkspacePage() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const tab: InspectorTab = ['files', 'diff', 'git', 'run'].includes(viewParam ?? '')
    ? (viewParam as InspectorTab)
    : 'files';
  const selectedFile = searchParams.get('file') || undefined;
  const mobileInspectorOpen = ['files', 'diff', 'git', 'run'].includes(viewParam ?? '');
  const [promptVariables, setPromptVariables] = useState<Record<string, unknown>>({});

  const setTab = (nextTab: InspectorTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', nextTab);
    setSearchParams(next);
  };

  const setSelectedFile = (path: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', 'files');
    next.set('file', path);
    setSearchParams(next);
  };

  const closeMobileInspector = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  const session = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.get<SessionRecord>(`/sessions/${id}`),
    enabled: Boolean(id),
  });
  const configuration = useQuery({
    queryKey: ['session-configuration', id],
    queryFn: () => api.get<SessionConfigurationRecord>(`/sessions/${id}/configuration`),
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
  const eventQueryKey = ['events', id] as const;
  const events = useQuery({
    queryKey: eventQueryKey,
    queryFn: async () => {
      const existing = client.getQueryData<EventRecord[]>(eventQueryKey) ?? [];
      const incoming = await fetchSessionEventPages(id, existing.at(-1)?.seq ?? 0);
      return mergeSessionEvents(existing, incoming);
    },
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
    queryFn: () =>
      api.get<{
        terminal: { available: boolean; code?: string; message?: string };
      }>('/settings/capabilities'),
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
  const activeRun = runs.error
    ? undefined
    : [...(runs.data ?? [])]
        .reverse()
        .find((run) =>
          ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING'].includes(run.status),
        );
  const latestRunStatus = runs.data?.at(-1)?.status;

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
        void client.invalidateQueries({ queryKey: ['session-configuration', id] });
      },
      events.data?.at(-1)?.seq ?? 0,
    );
  }, [client, events.data, id]);

  useEffect(() => {
    if (!mobileInspectorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMobileInspector();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeMobileInspector, mobileInspectorOpen]);

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
        {agents.error && (
          <div className="workspace-query-error-inline" role="alert">
            Agent 信息加载失败：{agents.error.message}
            <button type="button" onClick={() => agents.refetch()}>
              重试
            </button>
          </div>
        )}
      </div>
      <Tabs.Root value={mobileInspectorOpen ? tab : 'conversation'}>
        <Tabs.List className="workspace-mobile-tabs" aria-label="Workspace 视图">
          <Tabs.Trigger value="conversation" aria-label="对话" onClick={closeMobileInspector}>
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
          <SessionRail sessions={sessions} currentId={id} />
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
            messages={messages}
            events={events}
            approvals={approvals}
            activeRun={activeRun}
            latestRunStatus={latestRunStatus}
          />
        </Panel>
        <Separator className="resize-handle" />
        <Panel
          id="inspector"
          defaultSize="33%"
          minSize="300px"
          className={`workspace-panel inspector-panel ${mobileInspectorOpen ? 'mobile-open' : ''}`}
        >
          {mobileInspectorOpen && (
            <button
              type="button"
              className="workspace-drawer-close"
              aria-label="关闭检查器"
              onClick={closeMobileInspector}
            >
              <X size={18} />
            </button>
          )}
          <Inspector
            project={project}
            projects={projects}
            session={session.data}
            tab={tab}
            setTab={setTab}
            selectedFile={selectedFile}
            setSelectedFile={setSelectedFile}
            agent={agent}
            runs={runs}
          />
        </Panel>
      </Group>
      {mobileInspectorOpen && (
        <button
          type="button"
          className="workspace-drawer-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={closeMobileInspector}
        />
      )}
      <TerminalDock
        capability={capability.data?.terminal}
        capabilityError={capability.error}
        projectId={project?.id}
        projectRoot={project?.realRootPath}
        cwd={session.data.cwd}
      />
      <Composer
        session={session.data}
        agent={agent}
        events={events}
        project={project}
        activeRun={activeRun}
        promptContext={promptContext.data}
        promptContextLoading={promptContext.isLoading}
        promptContextError={promptContext.error}
        promptContextRetry={() => promptContext.refetch()}
        promptVariables={promptVariables}
        setPromptVariables={setPromptVariables}
        configuration={configuration.data}
        configurationLoading={configuration.isLoading}
        configurationError={configuration.error}
      />
    </div>
  );
}
