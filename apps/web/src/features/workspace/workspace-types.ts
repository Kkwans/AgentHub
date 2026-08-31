import type {
  AgentRecord,
  ApprovalRecord,
  EventRecord,
  FileEntry,
  MessageRecord,
  ProjectRecord,
  ResolvedPromptContextRecord,
  RunRecord,
  SessionConfigurationRecord,
  SessionRecord,
} from '../../lib/api';

export type InspectorTab = 'changes' | 'files' | 'activity' | 'run';

export type QueryState<T> = {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  refetch: () => unknown;
};

export type GitStatusRecord = {
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
    stagedStats?: { additions: number; deletions: number };
    worktreeStats?: { additions: number; deletions: number };
  }>;
};

export type GitDiffRecord = {
  patch: string;
  truncated: boolean;
  staged: boolean;
  whitespace?: 'default' | 'ignore-all-space' | 'ignore-space-change' | 'ignore-blank-lines';
};

export type GitCommitRecord = {
  sha: string;
  shortSha: string;
  authorName: string;
  authoredAt: string;
  subject: string;
};

export type GitBranchRecord = {
  name: string;
  sha: string;
  current: boolean;
  upstream?: string;
  committedAt: string;
};

export type WorkspaceData = {
  session: SessionRecord;
  agent: AgentRecord | undefined;
  project: ProjectRecord | undefined;
  messages: QueryState<MessageRecord[]>;
  events: QueryState<EventRecord[]>;
  approvals: QueryState<ApprovalRecord[]>;
  runs: QueryState<RunRecord[]>;
  configuration: QueryState<SessionConfigurationRecord>;
  promptContext: ResolvedPromptContextRecord | undefined;
  promptContextLoading: boolean;
  promptContextError: Error | null;
  promptContextRetry: () => unknown;
  promptVariables: Record<string, unknown>;
  setPromptVariables: (variables: Record<string, unknown>) => void;
};

export type WorkspaceGitData = {
  files: QueryState<FileEntry[]>;
  fileContent: QueryState<{ content: string; path: string }>;
  gitStatus: QueryState<GitStatusRecord>;
  gitDiff: QueryState<GitDiffRecord>;
  gitCommits: QueryState<GitCommitRecord[]>;
  gitBranches: QueryState<GitBranchRecord[]>;
};
