import { Tabs } from '@agenthub/ui';

import { EmptyState, ErrorState, LoadingState } from '../../../components/Common';
import type {
  AgentRecord,
  EventRecord,
  FileEntry,
  ProjectRecord,
  RunRecord,
  SessionRecord,
} from '../../../lib/api';
import type {
  GitBranchRecord,
  GitCommitRecord,
  GitDiffRecord,
  GitStatusRecord,
  InspectorTab,
  QueryState,
} from '../workspace-types';
import { ActivityPanel } from './ActivityPanel';
import { FileInspector } from './FileInspector';
import { GitChangesTree } from './GitChangesTree';
import { RunPanel } from './RunPanel';

export type { InspectorTab } from '../workspace-types';

export function WorkspaceInspector({
  project,
  projects,
  session,
  tab,
  setTab,
  selectedFile,
  setSelectedFile,
  selectedChangePath,
  setSelectedChangePath,
  diffWhitespace,
  setDiffWhitespace,
  agent,
  runs,
  events,
  files,
  fileContent,
  gitStatus,
  gitDiff,
  gitCommits,
  gitBranches,
  onCommit,
  stagedDiff,
  onStagedDiffChange,
}: {
  project: ProjectRecord | undefined;
  projects: QueryState<ProjectRecord[]>;
  session: SessionRecord;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  selectedFile: string | undefined;
  setSelectedFile: (path: string) => void;
  selectedChangePath: string | undefined;
  setSelectedChangePath: (path: string, view?: 'diff' | 'files') => void;
  diffWhitespace: 'default' | 'ignore-all-space' | 'ignore-space-change' | 'ignore-blank-lines';
  setDiffWhitespace: (
    value: 'default' | 'ignore-all-space' | 'ignore-space-change' | 'ignore-blank-lines',
  ) => void;
  agent: AgentRecord | undefined;
  runs: QueryState<RunRecord[]>;
  events: QueryState<EventRecord[]>;
  files: QueryState<FileEntry[]>;
  fileContent: QueryState<{ content: string; path: string }>;
  gitStatus: QueryState<GitStatusRecord>;
  gitDiff: QueryState<GitDiffRecord>;
  gitCommits: QueryState<GitCommitRecord[]>;
  gitBranches: QueryState<GitBranchRecord[]>;
  onCommit: (input: { paths: string[]; message: string }) => Promise<{ sha?: string }>;
  stagedDiff: boolean;
  onStagedDiffChange: (value: boolean) => void;
}) {
  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'changes', label: '变更' },
    { id: 'files', label: '文件' },
    { id: 'tools', label: '工具调用' },
    { id: 'run', label: 'Run' },
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
          <FileInspector
            selected={selectedFile}
            onSelect={setSelectedFile}
            files={files}
            content={fileContent}
          />
        ) : tab === 'changes' ? (
          <GitChangesTree
            status={gitStatus}
            diff={gitDiff}
            commits={gitCommits}
            branches={gitBranches}
            onCommit={onCommit}
            stagedDiff={stagedDiff}
            onStagedDiffChange={onStagedDiffChange}
            selectedPath={selectedChangePath}
            onSelectPath={(path, view) => {
              setSelectedChangePath(path, view);
            }}
            whitespace={diffWhitespace}
            onWhitespaceChange={setDiffWhitespace}
          />
        ) : tab === 'tools' ? (
          <ActivityPanel events={events} />
        ) : (
          <RunPanel agent={agent} session={session} runs={runs} />
        )}
      </div>
    </div>
  );
}

/** Compatibility export for consumers that still call the panel Inspector. */
export const Inspector = WorkspaceInspector;
