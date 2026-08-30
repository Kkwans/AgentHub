import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ChevronRight, GitBranch, GitCompareArrows, Menu, Tabs, X } from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../../components/Common';
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
  type SessionContinuationRecord,
  type SessionConfigurationRecord,
  type SessionRecord,
} from '../../../lib/api';
import { realtime } from '../../../lib/realtime';
import { Composer } from '../components/Composer';
import { Conversation } from '../components/Conversation';
import { SessionRail } from '../components/SessionRail';
import { WorkspaceInspector, type InspectorTab } from '../components/WorkspaceInspector';
import {
  TerminalDock,
  type TerminalEvent,
  type TerminalOpenInput,
  type TerminalRecord,
} from '../components/TerminalDock';
import { readWorkspaceLayout, writeWorkspacePanel } from '../layoutPreferences';
import type {
  GitBranchRecord,
  GitCommitRecord,
  GitDiffRecord,
  GitStatusRecord,
} from '../workspace-types';
import workspaceStyles from '../workspace.module.css';

const EVENT_PAGE_SIZE = 500;
type DiffWhitespace = 'default' | 'ignore-all-space' | 'ignore-space-change' | 'ignore-blank-lines';

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
  const navigate = useNavigate();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const tab: InspectorTab =
    viewParam === 'files' || viewParam === 'run' || viewParam === 'tools'
      ? viewParam
      : viewParam === 'diff' || viewParam === 'git' || viewParam === 'changes'
        ? 'changes'
        : 'changes';
  const selectedFile = searchParams.get('file') || undefined;
  const selectedChangePath = searchParams.get('change') || undefined;
  const whitespaceParam = searchParams.get('whitespace');
  const diffWhitespace: DiffWhitespace =
    whitespaceParam === 'ignore-all-space' ||
    whitespaceParam === 'ignore-space-change' ||
    whitespaceParam === 'ignore-blank-lines'
      ? whitespaceParam
      : 'default';
  const mobileInspectorOpen = ['files', 'diff', 'git', 'changes', 'tools', 'run'].includes(
    viewParam ?? '',
  );
  const [promptVariables, setPromptVariables] = useState<Record<string, unknown>>({});
  const [stagedDiff, setStagedDiff] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workspaceLayout, setWorkspaceLayout] = useState(readWorkspaceLayout);
  const sessionPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  const sessionCloseRef = useRef<HTMLButtonElement>(null);
  const inspectorCloseRef = useRef<HTMLButtonElement>(null);

  const toggleWorkspacePanel = useCallback(
    (side: 'left' | 'right') => {
      const panel = side === 'left' ? sessionPanelRef.current : inspectorPanelRef.current;
      if (!panel) return;
      const collapsed = panel.isCollapsed();
      if (collapsed) {
        panel.expand();
        requestAnimationFrame(() => {
          const leftPanel = sessionPanelRef.current;
          const rightPanel = inspectorPanelRef.current;
          panel.resize(
            `${side === 'left' ? workspaceLayout.leftWidth : workspaceLayout.rightWidth}px`,
          );
          if (side === 'right' && leftPanel && !leftPanel.isCollapsed())
            leftPanel.resize(`${workspaceLayout.leftWidth}px`);
          if (side === 'left' && rightPanel && !rightPanel.isCollapsed())
            rightPanel.resize(`${workspaceLayout.rightWidth}px`);
        });
      } else panel.collapse();
      const nextCollapsed = !collapsed;
      writeWorkspacePanel(side, { collapsed: nextCollapsed });
      setWorkspaceLayout((current) =>
        side === 'left'
          ? { ...current, leftCollapsed: nextCollapsed }
          : { ...current, rightCollapsed: nextCollapsed },
      );
    },
    [inspectorPanelRef, sessionPanelRef, workspaceLayout.leftWidth, workspaceLayout.rightWidth],
  );

  const handleWorkspaceLayoutChanged = useCallback(
    (_layout: Record<string, number>, meta: { isUserInteraction: boolean }) => {
      if (!meta.isUserInteraction) return;
      const leftPanel = sessionPanelRef.current;
      const rightPanel = inspectorPanelRef.current;
      const leftSize = leftPanel?.getSize();
      const rightSize = rightPanel?.getSize();
      if (leftSize && leftPanel) {
        writeWorkspacePanel('left', {
          width: leftSize.inPixels,
          collapsed: leftPanel.isCollapsed(),
        });
      }
      if (rightSize && rightPanel) {
        writeWorkspacePanel('right', {
          width: rightSize.inPixels,
          collapsed: rightPanel.isCollapsed(),
        });
      }
      setWorkspaceLayout((current) => ({
        ...current,
        ...(leftSize
          ? {
              leftWidth: leftSize.inPixels,
              leftCollapsed: leftPanel?.isCollapsed() ?? current.leftCollapsed,
            }
          : {}),
        ...(rightSize
          ? {
              rightWidth: rightSize.inPixels,
              rightCollapsed: rightPanel?.isCollapsed() ?? current.rightCollapsed,
            }
          : {}),
      }));
    },
    [inspectorPanelRef, sessionPanelRef],
  );

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

  const setSelectedChangePath = (path: string, view: 'diff' | 'files' = 'diff') => {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    if (view === 'diff') {
      next.set('change', path);
      next.delete('file');
    } else {
      next.set('file', path);
      next.delete('change');
    }
    setSearchParams(next);
  };

  const setDiffWhitespace = (value: DiffWhitespace) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'default') next.delete('whitespace');
    else next.set('whitespace', value);
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
  const openTerminal = useCallback(
    (input: TerminalOpenInput) => api.post<TerminalRecord>('/terminals', input),
    [],
  );
  const sendTerminalInput = useCallback(
    (terminalId: string, data: string) => api.post(`/terminals/${terminalId}/input`, { data }),
    [],
  );
  const resizeTerminal = useCallback(
    (terminalId: string, input: { cols: number; rows: number }) =>
      api.post(`/terminals/${terminalId}/resize`, input),
    [],
  );
  const closeTerminal = useCallback(
    (terminalId: string) => api.post(`/terminals/${terminalId}/close`),
    [],
  );
  const subscribeTerminal = useCallback(
    (topic: string, listener: (event: TerminalEvent) => void) =>
      realtime.subscribe(topic, (event) => listener(event as TerminalEvent)),
    [],
  );
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
  const files = useQuery({
    queryKey: ['files', project?.id],
    queryFn: () => api.get<FileEntry[]>(`/projects/${project?.id ?? ''}/files?depth=4`),
    enabled: Boolean(project?.id),
  });
  const fileContent = useQuery({
    queryKey: ['file', project?.id, selectedFile],
    queryFn: () =>
      api.get<{ content: string; path: string }>(
        `/projects/${project?.id ?? ''}/files/content?path=${encodeURIComponent(selectedFile ?? '')}`,
      ),
    enabled: Boolean(project?.id && selectedFile),
  });
  const gitStatus = useQuery({
    queryKey: ['git-status', project?.id],
    queryFn: () => api.get<GitStatusRecord>(`/projects/${project?.id ?? ''}/git/status`),
    enabled: Boolean(project?.id),
    refetchInterval: 5_000,
    retry: false,
  });
  const gitDiff = useQuery({
    queryKey: ['git-diff', project?.id, stagedDiff, selectedChangePath, diffWhitespace],
    queryFn: () =>
      api.get<GitDiffRecord>(
        `/projects/${project?.id ?? ''}/git/diff?staged=${String(stagedDiff)}${selectedChangePath ? `&path=${encodeURIComponent(selectedChangePath)}` : ''}&whitespace=${encodeURIComponent(diffWhitespace)}`,
      ),
    enabled: Boolean(project?.id && tab === 'changes'),
    retry: false,
  });
  const gitCommits = useQuery({
    queryKey: ['git-commits', project?.id],
    queryFn: () =>
      api.get<GitCommitRecord[]>(`/projects/${project?.id ?? ''}/git/commits?limit=30`),
    enabled: Boolean(project?.id && tab === 'changes'),
    retry: false,
  });
  const gitBranches = useQuery({
    queryKey: ['git-branches', project?.id],
    queryFn: () => api.get<GitBranchRecord[]>(`/projects/${project?.id ?? ''}/git/branches`),
    enabled: Boolean(project?.id && tab === 'changes'),
    retry: false,
  });
  const resolveApproval = useMutation({
    mutationFn: ({ id: approvalId, optionId }: { id: string; optionId: string }) =>
      api.post<ApprovalRecord>(`/approvals/${approvalId}/resolve`, { optionId }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['approvals', id] });
      void client.invalidateQueries({ queryKey: ['runs', id] });
      void client.invalidateQueries({ queryKey: ['session', id] });
    },
  });
  const sendRun = useMutation({
    mutationFn: (input: { text: string; promptVariables: Record<string, unknown> }) =>
      api.post(`/sessions/${id}/runs`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['runs', id] });
      void client.invalidateQueries({ queryKey: ['messages', id] });
      void client.invalidateQueries({ queryKey: ['session', id] });
    },
  });
  const stopRun = useMutation({
    mutationFn: (runId: string) => api.post(`/sessions/${id}/runs/${runId}/cancel`),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['runs', id] });
      void client.invalidateQueries({ queryKey: ['session', id] });
    },
  });
  const updateConfiguration = useMutation({
    mutationFn: (patch: { model?: string; mode?: string; reasoningEffort?: string }) =>
      api.post<SessionConfigurationRecord>(`/sessions/${id}/configuration`, patch),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session', id] });
      void client.invalidateQueries({ queryKey: ['session-configuration', id] });
      void client.invalidateQueries({ queryKey: ['events', id] });
    },
  });
  const commitGit = useMutation({
    mutationFn: (input: { paths: string[]; message: string }) =>
      api.post<{ sha?: string }>(`/projects/${project?.id ?? ''}/git/commit`, {
        mode: 'SELECTED',
        ...input,
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['git-status', project?.id] }),
        client.invalidateQueries({ queryKey: ['git-diff', project?.id] }),
        client.invalidateQueries({ queryKey: ['git-commits', project?.id] }),
        client.invalidateQueries({ queryKey: ['git-branches', project?.id] }),
      ]);
    },
  });
  const continuation = useQuery({
    queryKey: ['session-continuation', id],
    queryFn: () => api.get<SessionContinuationRecord>(`/sessions/${id}/continuation`),
    enabled: Boolean(session.data?.continuedFromSessionId),
    retry: false,
  });
  const continueSession = useMutation({
    mutationFn: () =>
      api.post<{ session: SessionRecord; continuation: SessionContinuationRecord }>(
        `/sessions/${id}/continuations`,
      ),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/workspace/${result.session.id}`);
    },
  });
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
    const inspectorActsAsDrawer = window.matchMedia('(max-width: 1279px)').matches;
    if (!sessionDrawerOpen && (!mobileInspectorOpen || !inspectorActsAsDrawer)) return;

    const closeButton = sessionDrawerOpen ? sessionCloseRef.current : inspectorCloseRef.current;
    closeButton?.focus();
    const drawer = closeButton?.closest<HTMLElement>('.session-rail-panel, .inspector-panel');
    const closeOnEscapeAndTrapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSessionDrawerOpen(false);
        closeMobileInspector();
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscapeAndTrapFocus);
    return () => window.removeEventListener('keydown', closeOnEscapeAndTrapFocus);
  }, [closeMobileInspector, mobileInspectorOpen, sessionDrawerOpen]);

  if (session.isLoading) return <LoadingState label="正在打开 Coding Workspace" />;
  if (session.error) return <ErrorState error={session.error} />;
  if (!session.data)
    return <EmptyState title="会话不存在" description="返回会话列表选择可用会话。" />;

  return (
    <div className={`${workspaceStyles.workspace} workspace-shell`}>
      <div className={`${workspaceStyles.contextbar} workspace-contextbar`}>
        <button
          type="button"
          className="workspace-session-toggle"
          aria-label="打开会话列表"
          aria-expanded={sessionDrawerOpen}
          onClick={() => setSessionDrawerOpen((open) => !open)}
        >
          <Menu size={17} />
          <span>会话</span>
        </button>
        <button
          type="button"
          className="workspace-inspector-toggle"
          aria-label="打开检查器"
          aria-expanded={mobileInspectorOpen}
          onClick={() => {
            if (mobileInspectorOpen) closeMobileInspector();
            else setTab('changes');
          }}
        >
          <GitCompareArrows size={17} />
          <span>检查器</span>
        </button>
        <div className={workspaceStyles.contextTitle}>
          <Link to="/sessions">会话</Link>
          <ChevronRight size={14} />
          <strong>{session.data.title}</strong>
          <span className={workspaceStyles.sessionStatus}>
            <StatusBadge status={session.data.status} />
          </span>
        </div>
        <div className={workspaceStyles.contextFacts}>
          <span>
            <Bot size={14} /> {agent?.name ?? 'Agent 未知'}
          </span>
          <span>
            <GitBranch size={14} /> {session.data.branch || '无 Git'}
          </span>
          <code title={session.data.cwd}>{session.data.cwd}</code>
        </div>
        <div className="workspace-layout-actions" aria-label="Workspace 面板布局">
          <button
            type="button"
            aria-label={workspaceLayout.leftCollapsed ? '展开会话列表' : '折叠会话列表'}
            title={workspaceLayout.leftCollapsed ? '展开会话列表' : '折叠会话列表'}
            onClick={() => toggleWorkspacePanel('left')}
          >
            <Menu size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={workspaceLayout.rightCollapsed ? '展开检查器' : '折叠检查器'}
            title={workspaceLayout.rightCollapsed ? '展开检查器' : '折叠检查器'}
            onClick={() => toggleWorkspacePanel('right')}
          >
            <GitCompareArrows size={15} aria-hidden="true" />
            <span>变更</span>
          </button>
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
        <Tabs.List
          className={`${workspaceStyles.mobileTabs} workspace-mobile-tabs`}
          aria-label="Workspace 视图"
        >
          <Tabs.Trigger value="conversation" aria-label="对话" onClick={closeMobileInspector}>
            对话
          </Tabs.Trigger>
          {(
            [
              ['files', '文件'],
              ['changes', 'Git'],
              ['tools', '工具调用'],
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
      <Group
        id="workspace-panels"
        orientation="horizontal"
        className={`${workspaceStyles.panels} workspace-panels`}
        onLayoutChanged={handleWorkspaceLayoutChanged}
      >
        <Panel
          id="sessions"
          panelRef={sessionPanelRef}
          defaultSize={workspaceLayout.leftCollapsed ? '0px' : workspaceLayout.leftWidth}
          collapsedSize="0px"
          collapsible
          minSize="210px"
          maxSize="380px"
          groupResizeBehavior="preserve-pixel-size"
          className={`${workspaceStyles.panel} ${workspaceStyles.sessionRail} ${!workspaceLayout.leftCollapsed ? workspaceStyles.panelOpen : ''} workspace-panel session-rail-panel ${sessionDrawerOpen ? 'mobile-open' : ''}`}
        >
          {sessionDrawerOpen && (
            <button
              type="button"
              className="workspace-drawer-close"
              aria-label="关闭会话列表"
              ref={sessionCloseRef}
              onClick={() => setSessionDrawerOpen(false)}
            >
              <X size={18} />
            </button>
          )}
          <SessionRail
            sessions={sessions}
            currentId={id}
            projectId={project?.id}
            onSelect={() => setSessionDrawerOpen(false)}
          />
        </Panel>
        <Separator className={`${workspaceStyles.separator} resize-handle`} />
        <Panel
          id="conversation"
          minSize="360px"
          className={`${workspaceStyles.panel} ${workspaceStyles.conversationPanel} workspace-panel conversation-panel`}
        >
          <div className={workspaceStyles.conversationShell}>
            <Conversation
              session={session.data}
              messages={messages}
              events={events}
              approvals={approvals}
              activeRun={activeRun}
              latestRunStatus={latestRunStatus}
              continuation={continuation.data}
              continuePending={continueSession.isPending}
              continueError={continueSession.error}
              onContinue={() => continueSession.mutate()}
              onResolveApproval={(approvalId, optionId) =>
                resolveApproval.mutateAsync({ id: approvalId, optionId })
              }
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
              onSend={(input) => sendRun.mutateAsync(input)}
              onStop={(runId) => stopRun.mutateAsync(runId)}
              onUpdateConfiguration={(patch) => updateConfiguration.mutateAsync(patch)}
              terminalControl={
                <TerminalDock
                  capability={capability.data?.terminal}
                  capabilityError={capability.error}
                  projectId={project?.id}
                  projectRoot={project?.realRootPath}
                  cwd={session.data.cwd}
                  openTerminal={openTerminal}
                  sendInput={sendTerminalInput}
                  resizeTerminal={resizeTerminal}
                  closeTerminal={closeTerminal}
                  subscribe={subscribeTerminal}
                />
              }
            />
          </div>
        </Panel>
        <Separator className={`${workspaceStyles.separator} resize-handle`} />
        <Panel
          id="inspector"
          panelRef={inspectorPanelRef}
          defaultSize={workspaceLayout.rightCollapsed ? '0px' : workspaceLayout.rightWidth}
          collapsedSize="0px"
          collapsible
          minSize="320px"
          maxSize="720px"
          groupResizeBehavior="preserve-pixel-size"
          className={`${workspaceStyles.panel} ${workspaceStyles.inspectorPanel} ${!workspaceLayout.rightCollapsed ? workspaceStyles.panelOpen : ''} workspace-panel inspector-panel ${mobileInspectorOpen ? 'mobile-open' : ''}`}
        >
          {mobileInspectorOpen && (
            <button
              type="button"
              className="workspace-drawer-close"
              aria-label="关闭检查器"
              ref={inspectorCloseRef}
              onClick={closeMobileInspector}
            >
              <X size={18} />
            </button>
          )}
          <WorkspaceInspector
            project={project}
            projects={projects}
            session={session.data}
            tab={tab}
            setTab={setTab}
            selectedFile={selectedFile}
            setSelectedFile={setSelectedFile}
            selectedChangePath={selectedChangePath}
            setSelectedChangePath={setSelectedChangePath}
            diffWhitespace={diffWhitespace}
            setDiffWhitespace={setDiffWhitespace}
            agent={agent}
            runs={runs}
            events={events}
            files={files}
            fileContent={fileContent}
            gitStatus={gitStatus}
            gitDiff={gitDiff}
            gitCommits={gitCommits}
            gitBranches={gitBranches}
            onCommit={(input) => commitGit.mutateAsync(input)}
            stagedDiff={stagedDiff}
            onStagedDiffChange={setStagedDiff}
          />
        </Panel>
      </Group>
      {(mobileInspectorOpen || sessionDrawerOpen) && (
        <button
          type="button"
          className="workspace-drawer-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => {
            setSessionDrawerOpen(false);
            closeMobileInspector();
          }}
        />
      )}
    </div>
  );
}
