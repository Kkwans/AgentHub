import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  AhTabs,
  Bot,
  ChevronRight,
  GitBranch,
  GitCompareArrows,
  Menu,
  WorkbenchDisclosure,
  X,
} from '@agenthub/ui';
import { Link } from 'react-router-dom';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { StatusBadge } from '../../../components/Feedback';
import { Composer } from '../components/Composer';
import { Conversation } from '../components/Conversation';
import { SessionRail } from '../components/SessionRail';
import { TerminalDock } from '../components/TerminalDock';
import { WorkspaceInspector, type InspectorTab } from '../components/WorkspaceInspector';
import { WORKSPACE_PANEL_LIMITS } from '../layoutPreferences';
import workspaceStyles from '../workspace.module.css';

import type { WorkspacePageModel } from '../useWorkspaceViewModel';

type SavedInlineStyle = { priority: string; value: string };

const workspaceDrawerWidths = { left: 256, right: 380 } as const;

const responsiveHostProperties = [
  'position',
  'inset',
  'inset-inline',
  'inset-block',
  'z-index',
  'display',
  'flex',
  'width',
  'min-width',
  'max-width',
  'height',
  'visibility',
  'pointer-events',
  'box-shadow',
] as const;

const responsiveConversationProperties = [
  'position',
  'inset',
  'display',
  'flex',
  'width',
  'min-width',
  'max-width',
  'height',
] as const;

function useResponsiveDrawerHost(
  hostRef: RefObject<HTMLDivElement | null>,
  compact: boolean,
  open: boolean,
  side: 'left' | 'right',
  width: number,
) {
  const savedStyles = useRef(new Map<string, SavedInlineStyle>());

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const remember = (property: string) => {
      if (savedStyles.current.has(property)) return;
      savedStyles.current.set(property, {
        value: host.style.getPropertyValue(property),
        priority: host.style.getPropertyPriority(property),
      });
    };
    const set = (property: string, value: string) => {
      remember(property);
      host.style.setProperty(property, value);
    };

    if (!compact) {
      for (const property of responsiveHostProperties) {
        const original = savedStyles.current.get(property);
        if (!original) continue;
        if (original.value) host.style.setProperty(property, original.value, original.priority);
        else host.style.removeProperty(property);
      }
      savedStyles.current.clear();
      return;
    }

    set('position', 'absolute');
    set('inset', side === 'left' ? '0 auto 0 0' : '0 0 0 auto');
    set('z-index', '45');
    set('display', open ? 'flex' : 'none');
    set('flex', open ? '0 0 auto' : '0 0 0');
    set('width', open ? `min(${width}px, calc(100% - 24px))` : '0px');
    set('min-width', '0');
    set('max-width', open ? `min(${width}px, calc(100% - 24px))` : '0px');
    set('height', '100%');
    set('visibility', open ? 'visible' : 'hidden');
    set('pointer-events', open ? 'auto' : 'none');
    set('box-shadow', open ? 'var(--ah-shadow-lg, 0 28px 76px -28px rgb(17 22 38 / 34%))' : 'none');
  }, [compact, hostRef, open, side, width]);
}

function useResponsiveConversationHost(
  hostRef: RefObject<HTMLDivElement | null>,
  compact: boolean,
  mobile: boolean,
) {
  const savedStyles = useRef(new Map<string, SavedInlineStyle>());

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const remember = (property: string) => {
      if (savedStyles.current.has(property)) return;
      savedStyles.current.set(property, {
        value: host.style.getPropertyValue(property),
        priority: host.style.getPropertyPriority(property),
      });
    };
    const set = (property: string, value: string) => {
      remember(property);
      host.style.setProperty(property, value);
    };

    if (compact) {
      set('position', mobile ? 'absolute' : 'relative');
      set('inset', mobile ? '0' : 'auto');
      set('flex', mobile ? '0 0 auto' : '1 1 100%');
      set('width', '100%');
      set('min-width', '0');
      set('max-width', '100%');
      set('height', '100%');
      return;
    }

    for (const property of responsiveConversationProperties) {
      const value = savedStyles.current.get(property);
      if (!value) continue;
      if (value.value) host.style.setProperty(property, value.value, value.priority);
      else host.style.removeProperty(property);
    }
    savedStyles.current.clear();
  }, [compact, hostRef, mobile]);
}

export function WorkspaceView({ model }: { model: WorkspacePageModel }) {
  const {
    id,
    session,
    sessionDrawerOpen,
    auxiliaryPanel,
    openSessionDrawer,
    closeSessionDrawer,
    openInspectorDrawer,
    setAuxiliaryPanel,
    inspectorActsAsDrawer,
    isMobileViewport,
    inspectorDrawerOpen,
    closeMobileInspector,
    tab,
    setTab,
    agent,
    project,
    capability,
    openTerminal,
    sendTerminalInput,
    resizeTerminal,
    closeTerminal,
    subscribeTerminal,
    workspaceLayout,
    toggleWorkspacePanel,
    agents,
    sessions,
    sessionPanelRef,
    sessionCloseRef,
    sessionToggleRef,
    mobileSessionsRef,
    handleWorkspaceLayoutChanged,
    messages,
    events,
    approvals,
    runs,
    activeRun,
    latestRunStatus,
    continuation,
    continueSession,
    resolveApproval,
    promptContext,
    promptVariables,
    setPromptVariables,
    configuration,
    sendRun,
    stopRun,
    updateConfiguration,
    inspectorPanelRef,
    inspectorCloseRef,
    projects,
    selectedFile,
    setSelectedFile,
    selectedChangePath,
    setSelectedChangePath,
    diffWhitespace,
    setDiffWhitespace,
    files,
    fileContent,
    gitStatus,
    gitDiff,
    gitCommits,
    gitBranches,
    commitGit,
    stagedDiff,
    setStagedDiff,
  } = model;

  const sessionPanelHostRef = useRef<HTMLDivElement>(null);
  const conversationPanelHostRef = useRef<HTMLDivElement>(null);
  const inspectorPanelHostRef = useRef<HTMLDivElement>(null);
  useResponsiveDrawerHost(
    sessionPanelHostRef,
    inspectorActsAsDrawer,
    sessionDrawerOpen,
    'left',
    workspaceDrawerWidths.left,
  );
  const compactAuxiliaryOpen = sessionDrawerOpen || inspectorDrawerOpen;
  const mobilePanel = sessionDrawerOpen ? 'sessions' : inspectorDrawerOpen ? tab : 'conversation';
  const activeAuxiliaryPanel = inspectorDrawerOpen ? 'inspector' : auxiliaryPanel;
  useResponsiveConversationHost(conversationPanelHostRef, inspectorActsAsDrawer, isMobileViewport);
  useResponsiveDrawerHost(
    inspectorPanelHostRef,
    inspectorActsAsDrawer,
    inspectorDrawerOpen,
    'right',
    workspaceDrawerWidths.right,
  );

  if (!session.data) return null;
  const currentSession = session.data;

  return (
    <div
      className={`${workspaceStyles.workspace} workspace workspace-shell`}
      data-session-drawer-open={sessionDrawerOpen || undefined}
      data-inspector-drawer-open={inspectorDrawerOpen || undefined}
    >
      <div className={`${workspaceStyles.contextbar} workspace-contextbar`}>
        <button
          type="button"
          className="workspace-support-toggle"
          ref={sessionToggleRef}
          aria-label={compactAuxiliaryOpen ? '关闭辅助栏' : '打开辅助栏'}
          aria-expanded={compactAuxiliaryOpen}
          onClick={() => {
            if (compactAuxiliaryOpen) closeMobileInspector();
            else openSessionDrawer();
          }}
        >
          <Menu size={17} />
          <span>辅助栏</span>
        </button>
        <div className={workspaceStyles.contextTitle}>
          <Link to="/sessions">会话</Link>
          <ChevronRight size={14} />
          <strong>{currentSession.title}</strong>
          <span className={workspaceStyles.sessionStatus}>
            <StatusBadge status={currentSession.status} />
          </span>
        </div>
        <WorkbenchDisclosure
          className="workspace-context-disclosure"
          summary={
            <span className="workspace-context-disclosure-summary">
              <Bot size={14} aria-hidden="true" />
              <span>上下文</span>
              <small>{agent?.name ?? 'Agent 未知'}</small>
            </span>
          }
        >
          <div className={workspaceStyles.contextFacts}>
            <span>
              <Bot size={14} /> {agent?.name ?? 'Agent 未知'}
            </span>
            <span>
              <GitBranch size={14} /> {currentSession.branch || '无 Git'}
            </span>
            <code title={currentSession.cwd}>{currentSession.cwd}</code>
          </div>
        </WorkbenchDisclosure>
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
      <AhTabs.Root value={mobilePanel}>
        <AhTabs.List
          className={`${workspaceStyles.mobileTabs} workspace-mobile-tabs`}
          aria-label="Workspace 视图"
        >
          <AhTabs.Trigger
            value="sessions"
            aria-label="会话"
            ref={mobileSessionsRef}
            onClick={openSessionDrawer}
          >
            会话
          </AhTabs.Trigger>
          <AhTabs.Trigger value="conversation" aria-label="对话" onClick={closeMobileInspector}>
            对话
          </AhTabs.Trigger>
          {(
            [
              ['files', '文件'],
              ['changes', 'Git'],
              ['activity', '活动'],
              ['run', '运行'],
            ] as Array<[InspectorTab, string]>
          ).map(([item, label]) => (
            <AhTabs.Trigger
              key={item}
              value={item}
              aria-label={label}
              onClick={() => openInspectorDrawer(item)}
            >
              {label}
            </AhTabs.Trigger>
          ))}
        </AhTabs.List>
      </AhTabs.Root>
      <Group
        id="workspace-panels"
        orientation="horizontal"
        className={`${workspaceStyles.panels} workspace-panels`}
        onLayoutChanged={handleWorkspaceLayoutChanged}
      >
        <Panel
          id="sessions"
          elementRef={sessionPanelHostRef}
          panelRef={sessionPanelRef}
          defaultSize={workspaceLayout.leftCollapsed ? '0px' : workspaceLayout.leftWidth}
          collapsedSize="0px"
          collapsible
          minSize={`${WORKSPACE_PANEL_LIMITS.left.min}px`}
          maxSize={`${WORKSPACE_PANEL_LIMITS.left.max}px`}
          groupResizeBehavior="preserve-pixel-size"
          className={`${workspaceStyles.panel} ${workspaceStyles.sessionRail} ${!workspaceLayout.leftCollapsed ? workspaceStyles.panelOpen : ''} workspace-panel session-rail-panel ${sessionDrawerOpen ? 'mobile-open' : ''}`}
        >
          {sessionDrawerOpen && (
            <button
              type="button"
              className="workspace-drawer-close"
              aria-label="关闭会话列表"
              ref={sessionCloseRef}
              onClick={closeSessionDrawer}
            >
              <X size={18} />
            </button>
          )}
          {sessionDrawerOpen && !isMobileViewport && (
            <AuxiliarySwitcher
              active={activeAuxiliaryPanel}
              onSelect={(panel) => setAuxiliaryPanel(panel)}
            />
          )}
          <SessionRail
            sessions={sessions}
            currentId={id}
            projectId={project?.id}
            onSelect={closeSessionDrawer}
          />
        </Panel>
        <Separator className={`${workspaceStyles.separator} resize-handle`} />
        <Panel
          id="conversation"
          elementRef={conversationPanelHostRef}
          minSize="520px"
          className={`${workspaceStyles.panel} ${workspaceStyles.conversationPanel} workspace-panel conversation-panel`}
        >
          <div className={workspaceStyles.conversationShell}>
            <Conversation
              session={currentSession}
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
              hasPreviousMessages={messages.hasPrevious}
              isLoadingPreviousMessages={messages.isFetchingPrevious}
              onLoadPreviousMessages={messages.fetchPrevious}
            />
            <Composer
              session={currentSession}
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
            />
            <div className="workspace-terminal-slot">
              <TerminalDock
                capability={capability.data?.terminal}
                capabilityError={capability.error}
                projectId={project?.id}
                sessionId={currentSession.id}
                projectRoot={project?.realRootPath}
                cwd={currentSession.cwd}
                openTerminal={openTerminal}
                sendInput={sendTerminalInput}
                resizeTerminal={resizeTerminal}
                closeTerminal={closeTerminal}
                subscribe={subscribeTerminal}
              />
            </div>
          </div>
        </Panel>
        <Separator className={`${workspaceStyles.separator} resize-handle`} />
        <Panel
          id="inspector"
          elementRef={inspectorPanelHostRef}
          panelRef={inspectorPanelRef}
          defaultSize={workspaceLayout.rightCollapsed ? '0px' : workspaceLayout.rightWidth}
          collapsedSize="0px"
          collapsible
          minSize={`${WORKSPACE_PANEL_LIMITS.right.min}px`}
          maxSize={`${WORKSPACE_PANEL_LIMITS.right.max}px`}
          groupResizeBehavior="preserve-pixel-size"
          className={`${workspaceStyles.panel} ${workspaceStyles.inspectorPanel} ${!workspaceLayout.rightCollapsed ? workspaceStyles.panelOpen : ''} workspace-panel inspector-panel ${inspectorDrawerOpen ? 'mobile-open' : ''}`}
        >
          {inspectorDrawerOpen && (
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
          {inspectorDrawerOpen && !isMobileViewport && (
            <AuxiliarySwitcher
              active={activeAuxiliaryPanel}
              onSelect={(panel) => setAuxiliaryPanel(panel)}
            />
          )}
          <WorkspaceInspector
            project={project}
            projects={projects}
            session={currentSession}
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
      {(inspectorDrawerOpen || sessionDrawerOpen) && (
        <button
          type="button"
          className="workspace-drawer-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => {
            closeMobileInspector();
          }}
        />
      )}
    </div>
  );
}

function AuxiliarySwitcher({
  active,
  onSelect,
}: {
  active: 'sessions' | 'inspector' | null;
  onSelect: (panel: 'sessions' | 'inspector') => void;
}) {
  return (
    <div className="workspace-auxiliary-switcher" role="tablist" aria-label="辅助栏视图">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'sessions'}
        onClick={() => onSelect('sessions')}
      >
        <Menu size={15} aria-hidden="true" />
        会话
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'inspector'}
        onClick={() => onSelect('inspector')}
      >
        <GitCompareArrows size={15} aria-hidden="true" />
        检查器
      </button>
    </div>
  );
}
