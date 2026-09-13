import {
  Bot,
  ChevronRight,
  GitBranch,
  GitCompareArrows,
  Menu,
  ScanSearch,
  Tabs as PinTabs,
  TabsList,
  TabsTrigger,
  ThreeColumnSplit,
  WorkbenchDisclosure,
  X,
  type CompactPanel,
} from '@agenthub/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../components/Feedback';
import { ChatCommandBar } from '../components/ChatCommandBar';
import { ChatConversationView } from '../components/ChatConversationView';
import { SessionRail } from '../components/SessionRail';
import { TerminalDock } from '../components/TerminalDock';
import { WorkspaceInspector, type InspectorTab } from '../components/WorkspaceInspector';
import workspaceStyles from '../workspace.module.css';

import type { WorkspacePageModel } from '../useWorkspaceViewModel';

export function WorkspaceView({ model }: { model: WorkspacePageModel }) {
  const [immersive, setImmersive] = useState(false);
  // Keep the Terminal trigger in the CommandBar, where the PinHarness source
  // places workspace actions. The dock itself remains a sibling only while
  // expanded, so a closed Terminal never creates an extra grid row.
  const terminalLauncherSlotRef = useRef<HTMLSpanElement>(null);
  const {
    id,
    session,
    sessionDrawerOpen,
    openSessionDrawer,
    closeSessionDrawer,
    openInspectorDrawer,
    mobileInspectorOpen,
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
    sessionCloseRef,
    inspectorCloseRef,
    sessionToggleRef,
    toggleWorkspacePanel,
    agents,
    sessions,
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

  const mediumAuxiliaryOpen =
    inspectorActsAsDrawer && !isMobileViewport && !workspaceLayout.leftCollapsed;
  const compactAuxiliaryOpen = sessionDrawerOpen || inspectorDrawerOpen || mediumAuxiliaryOpen;
  const compactPanel: CompactPanel = sessionDrawerOpen
    ? 'left'
    : inspectorDrawerOpen || mobileInspectorOpen
      ? 'right'
      : mediumAuxiliaryOpen
        ? 'left'
        : 'middle';
  // The source mobile command bar is controlled by the same panel state as the
  // drawer. Keep the outer tab strip controlled as well; a fixed
  // `conversation` value made Git/Files/Activity appear unselected after a
  // click even though the inspector had opened correctly.
  const mobileViewValue = sessionDrawerOpen
    ? 'sessions'
    : inspectorDrawerOpen || mobileInspectorOpen
      ? tab
      : 'conversation';
  // PinHarness 的三栏实现用比例保存宽度；把现有 v1/v2 的像素偏好先映射到
  // 1440px 工作台基准，保持 Rail/Inspector 的用户习惯而不清空 localStorage。
  const leftRatioDefault = Math.min(0.45, Math.max(0.12, workspaceLayout.leftWidth / 1440));
  const rightRatioDefault = Math.min(0.5, Math.max(0.18, workspaceLayout.rightWidth / 1440));

  useEffect(() => {
    document.body.classList.toggle('mobile-chat-immersive', immersive);
    return () => document.body.classList.remove('mobile-chat-immersive');
  }, [immersive]);

  const handleCompactPanelChange = (panel: CompactPanel) => {
    if (panel === 'left') openSessionDrawer();
    else if (panel === 'right') openInspectorDrawer(tab);
    else closeMobileInspector();
  };

  if (!session.data) return null;
  const currentSession = session.data;

  return (
    <div
      className={`${workspaceStyles.workspace} workspace workspace-page workspace-shell relative isolate flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]`}
      data-design-system="pinharness"
      data-mobile-immersive={immersive || undefined}
      data-session-drawer-open={sessionDrawerOpen || undefined}
      data-inspector-drawer-open={inspectorDrawerOpen || undefined}
    >
      <div className="workspace-contextbar relative z-10 flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[hsl(var(--border))]/70 bg-[hsl(var(--surface))] px-3 sm:px-4 lg:px-5">
        <button
          type="button"
          className="workspace-support-toggle"
          ref={sessionToggleRef}
          aria-label={compactAuxiliaryOpen ? '关闭辅助栏' : '打开辅助栏'}
          aria-expanded={compactAuxiliaryOpen}
          onClick={() => {
            if (compactAuxiliaryOpen) {
              if (inspectorActsAsDrawer && !isMobileViewport) {
                if (!workspaceLayout.leftCollapsed) toggleWorkspacePanel('left');
                closeMobileInspector();
              } else {
                closeMobileInspector();
              }
            } else if (inspectorActsAsDrawer && !isMobileViewport) {
              if (workspaceLayout.leftCollapsed) toggleWorkspacePanel('left');
              openSessionDrawer();
            } else {
              openSessionDrawer();
            }
          }}
        >
          <Menu size={17} />
          <span>辅助栏</span>
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            className="whitespace-nowrap text-[12px] font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:text-[hsl(var(--foreground))]"
            to="/sessions"
          >
            会话
          </Link>
          <ChevronRight className="shrink-0 text-[hsl(var(--foreground-faint))]" size={14} />
          <strong className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]">
            {currentSession.title}
          </strong>
          <span className={`${workspaceStyles.sessionStatus} inline-flex items-center gap-1.5`}>
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
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-[hsl(var(--foreground-faint))]">
            <span>
              <Bot size={14} /> {agent?.name ?? 'Agent 未知'}
            </span>
            <span>
              <GitBranch size={14} /> {currentSession.branch || '无 Git'}
            </span>
            <code title={currentSession.cwd}>{currentSession.cwd}</code>
          </div>
        </WorkbenchDisclosure>
        <button
          type="button"
          className="workspace-immersive-toggle"
          aria-label={immersive ? '退出沉浸对话' : '进入沉浸对话'}
          aria-pressed={immersive}
          title={immersive ? '退出沉浸对话' : '进入沉浸对话'}
          onClick={() => setImmersive((value) => !value)}
        >
          <ScanSearch size={16} aria-hidden="true" />
        </button>
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
            <span>Agent 信息加载失败：{agents.error.message}</span>
            <button type="button" onClick={() => agents.refetch()}>
              重试
            </button>
          </div>
        )}
      </div>
      {inspectorActsAsDrawer && (
        <PinTabs value={mobileViewValue}>
          <TabsList
            className={`${workspaceStyles.mobileTabs} workspace-mobile-tabs`}
            aria-label="Workspace 视图"
          >
            <TabsTrigger value="sessions" aria-label="会话" onClick={openSessionDrawer}>
              会话
            </TabsTrigger>
            <TabsTrigger value="conversation" aria-label="对话" onClick={closeMobileInspector}>
              对话
            </TabsTrigger>
            {(
              [
                ['files', '文件'],
                ['changes', 'Git'],
                ['activity', '活动'],
                ['run', '运行'],
              ] as Array<[InspectorTab, string]>
            ).map(([item, label]) => (
              <TabsTrigger
                key={item}
                value={item}
                aria-label={label}
                onClick={() => openInspectorDrawer(item)}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </PinTabs>
      )}
      <div
        id="workspace-panels"
        className="workspace-panels relative flex h-full min-h-0 min-w-0 flex-1 bg-[hsl(var(--surface))]"
      >
        <ThreeColumnSplit
          left={
            <section className="workspace-panel workbench-panel session-rail-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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
              <SessionRail
                sessions={sessions}
                currentId={id}
                projectId={project?.id}
                onSelect={closeSessionDrawer}
              />
            </section>
          }
          middle={
            <section className="workspace-panel workbench-panel conversation-panel h-full min-h-0 min-w-0 overflow-hidden">
              <div className="relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-[hsl(var(--surface))]">
                <ChatConversationView
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
                  onOpenFile={setSelectedFile}
                  onOpenDiff={(path) => setSelectedChangePath(path, 'diff')}
                  hasPreviousMessages={messages.hasPrevious}
                  isLoadingPreviousMessages={messages.isFetchingPrevious}
                  onLoadPreviousMessages={messages.fetchPrevious}
                  composer={
                    <ChatCommandBar
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
                      terminalLauncherSlotRef={terminalLauncherSlotRef}
                    />
                  }
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
                    launcherSlotRef={terminalLauncherSlotRef}
                  />
                </div>
              </div>
            </section>
          }
          right={
            <section className="workspace-panel workbench-panel inspector-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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
            </section>
          }
          leftCollapsed={workspaceLayout.leftCollapsed}
          rightCollapsed={workspaceLayout.rightCollapsed}
          onOpenLeft={() => toggleWorkspacePanel('left')}
          onOpenRight={() => toggleWorkspacePanel('right')}
          leftLabel="会话"
          rightLabel="检查器"
          middleLabel="对话"
          compactPanel={compactPanel}
          onCompactPanelChange={handleCompactPanelChange}
          compactPanelOrder={['middle', 'left', 'right']}
          compactTabsVisible={false}
          leftRatioKey="agenthub.workspace.layout-v3.left.ratio"
          rightRatioKey="agenthub.workspace.layout-v3.right.ratio"
          leftRatioDefault={leftRatioDefault}
          rightRatioDefault={rightRatioDefault}
          className="h-full min-h-0"
        />
      </div>
    </div>
  );
}
