import { Bot, ChevronRight, GitBranch, GitCompareArrows, Menu, Tabs, X } from '@agenthub/ui';
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

export function WorkspaceView({ model }: { model: WorkspacePageModel }) {
  const {
    id,
    session,
    sessionDrawerOpen,
    setSessionDrawerOpen,
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

  if (!session.data) return null;
  const currentSession = session.data;

  return (
    <div className={`${workspaceStyles.workspace} workspace workspace-shell`}>
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
          aria-expanded={inspectorDrawerOpen}
          onClick={() => {
            if (inspectorDrawerOpen) closeMobileInspector();
            else setTab('changes');
          }}
        >
          <GitCompareArrows size={17} />
          <span>检查器</span>
        </button>
        <div className={workspaceStyles.contextTitle}>
          <Link to="/sessions">会话</Link>
          <ChevronRight size={14} />
          <strong>{currentSession.title}</strong>
          <span className={workspaceStyles.sessionStatus}>
            <StatusBadge status={currentSession.status} />
          </span>
        </div>
        <div className={workspaceStyles.contextFacts}>
          <span>
            <Bot size={14} /> {agent?.name ?? 'Agent 未知'}
          </span>
          <span>
            <GitBranch size={14} /> {currentSession.branch || '无 Git'}
          </span>
          <code title={currentSession.cwd}>{currentSession.cwd}</code>
        </div>
        <div className="workspace-context-terminal">
          <TerminalDock
            capability={capability.data?.terminal}
            capabilityError={capability.error}
            projectId={project?.id}
            projectRoot={project?.realRootPath}
            cwd={currentSession.cwd}
            openTerminal={openTerminal}
            sendInput={sendTerminalInput}
            resizeTerminal={resizeTerminal}
            closeTerminal={closeTerminal}
            subscribe={subscribeTerminal}
          />
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
      <Tabs.Root value={inspectorDrawerOpen ? tab : 'conversation'}>
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
              ['activity', '活动'],
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
          </div>
        </Panel>
        <Separator className={`${workspaceStyles.separator} resize-handle`} />
        <Panel
          id="inspector"
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
            setSessionDrawerOpen(false);
            closeMobileInspector();
          }}
        />
      )}
    </div>
  );
}
