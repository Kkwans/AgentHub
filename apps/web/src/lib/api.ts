export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string; details?: Record<string, unknown> };
}

const errorMessages: Record<string, string> = {
  HTTP_ERROR: '请求失败，请稍后重试。',
  VALIDATION_FAILED: '提交的数据不符合要求，请检查后重试。',
  NOT_FOUND: '请求的资源不存在。',
  INTERNAL_ERROR: '服务发生异常，请前往设置查看诊断信息。',
  AUTH_REQUIRED: '当前 Agent 需要完成授权。',
  WORKSPACE_UNMAPPED: 'Project 目录未映射到目标容器。',
  EXECUTION_TARGET_NOT_FOUND: 'Execution Target 不存在。',
  AGENT_NOT_FOUND: 'Agent 不存在。',
  PROJECT_NOT_FOUND: 'Project 不存在。',
  SESSION_NOT_FOUND: 'Session 不存在。',
  PROMPT_NOT_FOUND: 'Prompt 不存在。',
  PROMPT_VERSION_NOT_FOUND: 'Prompt 版本不存在。',
  PROMPT_LABEL_NOT_FOUND: 'Prompt 标签不存在。',
  PROMPT_LATEST_LABEL_MANAGED: 'latest 标签由系统维护，不能手动移动或删除。',
  PROMPT_VARIABLES_MISSING: 'PromptOS 缺少必填变量，请先完成上下文预览。',
  PROMPT_BINDING_TARGET_NOT_FOUND: '绑定目标不存在。',
  SKILL_PATH_ESCAPE: 'Skill 路径超出 Project root，已阻止扫描。',
  API_TOKEN_NAME_EXISTS: 'API token 名称已存在。',
  API_TOKEN_NOT_FOUND: 'API token 不存在或已经撤销。',
  WORKTREE_EXECUTION_NOT_FOUND: 'Worktree Execution 不存在。',
  WORKTREE_QUEUE_CONFLICT: 'Task 已有隔离执行，或队列状态已经变化。',
  WORKTREE_NOT_READY: '隔离工作区尚未创建完成。',
  WORKTREE_EXECUTION_NOT_IN_REVIEW: '当前隔离执行尚未进入待审阅状态。',
  WORKTREE_EXECUTION_BUSY: 'Worktree 正在创建或合并，请等待当前步骤完成。',
  WORKTREE_MERGE_CONFLICT: '任务分支与 base branch 存在冲突，请继续修改后重试。',
  WORKTREE_MERGE_FAILED: '任务分支合并失败，主工作区已尝试恢复。',
  WORKTREE_COMMIT_FAILED: '无法创建受管提交，请检查 Git user 配置与变更状态。',
  PRIMARY_WORKTREE_DIRTY: 'Project 主工作区存在未提交变更，请先处理后再合并。',
  PRIMARY_BRANCH_CHANGED: 'Project 当前分支已不是登记的 base branch。',
  WORKTREE_BASE_DIVERGED: 'base branch 历史已替换，不能安全合并。',
  WORKTREE_PATH_ESCAPE: 'Worktree 路径超出受管目录，已阻止访问。',
  REMOTE_WORKTREE_NOT_AVAILABLE: 'Remote Node Worktree 将在下一阶段启用。',
};

const accessTokenKey = 'agenthub.access-token';

export const authTokenStore = {
  get(): string {
    return typeof window === 'undefined'
      ? ''
      : (window.sessionStorage.getItem(accessTokenKey) ?? '');
  },
  set(token: string): void {
    if (typeof window === 'undefined') return;
    const normalized = token.trim();
    if (normalized) window.sessionStorage.setItem(accessTokenKey, normalized);
    else window.sessionStorage.removeItem(accessTokenKey);
  },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = authTokenStore.get();
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as SuccessEnvelope<T> | ErrorEnvelope;
  if (!response.ok || 'error' in body) {
    const error = 'error' in body ? body.error : { code: 'HTTP_ERROR', message: '请求失败' };
    throw new ApiError(
      error.code,
      errorMessages[error.code] ?? error.message,
      response.status,
      'details' in error ? error.details : undefined,
    );
  }
  return body.data;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};

export interface ExecutionTargetRecord {
  id: string;
  name: string;
  kind: string;
  hostname: string;
  os: string;
  arch: string;
  status: string;
  containerName: string | null;
  expectedContainerId: string | null;
  startPolicy: string | null;
  workspaceMappingsJson: Array<{ hostRoot: string; containerRoot: string }>;
}

export interface AgentCatalogEntry {
  agentKind: string;
  name: string;
  recommendedTarget: 'LOCAL_HOST' | 'DOCKER_CONTAINER';
  adapterKind: string;
  command: string;
  notes: string;
}

export interface AgentRecord {
  id: string;
  targetId: string;
  name: string;
  agentKind: string;
  adapterKind: string;
  status: string;
  detectedVersion: string | null;
  defaultModel: string | null;
  defaultMode: string | null;
  capabilitiesJson: Record<string, unknown>;
  lastPreflightAt: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  targetId: string;
  rootPath: string;
  realRootPath: string;
  repoKind: string;
  status: string;
}

export interface SessionRecord {
  id: string;
  projectId: string;
  agentId: string;
  taskId: string | null;
  title: string;
  cwd: string;
  branch: string | null;
  status: string;
  model: string | null;
  mode: string | null;
  lastActiveAt: string;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  gitBeforeSha: string | null;
  gitAfterSha: string | null;
  errorCode: string | null;
}

export interface GoalRecord {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  successCriteria: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ACHIEVED' | 'CANCELED';
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  goalId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  status: 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'WAITING_REVIEW' | 'DONE' | 'BLOCKED' | 'CANCELED';
  priority: number;
  assignedAgentId: string | null;
  sessionId: string | null;
  finalRunId: string | null;
  branch: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type WorktreeExecutionStatus =
  | 'QUEUED'
  | 'SETTING_UP'
  | 'RUNNING'
  | 'AWAITING_INPUT'
  | 'REVIEW'
  | 'MERGING'
  | 'DONE'
  | 'BLOCKED'
  | 'CANCELED';

export interface WorktreeExecutionRecord {
  id: string;
  taskId: string;
  projectId: string;
  agentId: string;
  status: WorktreeExecutionStatus;
  baseBranch: string;
  baseSha: string;
  taskBranch: string;
  worktreePath: string | null;
  sessionId: string | null;
  runId: string | null;
  mergeCommitSha: string | null;
  configJson: { model?: string; mode?: string; promptVariables?: Record<string, unknown> };
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  reviewReadyAt: string | null;
  mergeStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeReviewRecord {
  worktreePath: string;
  baseSha: string;
  headSha: string;
  taskBranch: string;
  clean: boolean;
  aheadBy: number;
  entries: Array<{ index: string; worktree: string; path: string; originalPath?: string }>;
  patch: string;
  diffStat: string;
  truncated: boolean;
}

export interface DashboardSnapshot {
  runningSessions: SessionRecord[];
  attentionTasks: TaskRecord[];
  pendingApprovals: ApprovalRecord[];
  recentResults: Array<RunRecord & { gitOutcome: 'CHANGED' | 'UNCHANGED' | 'UNAVAILABLE' }>;
  agentHealth: AgentRecord[];
}

export interface ApiTokenRecord {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface MessageRecord {
  id: string;
  runId: string | null;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  kind: string;
  text: string | null;
  sequence: number;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  runId: string;
  title: string;
  description: string | null;
  status: string;
  optionsJson: Array<{ id?: string; label?: string; kind?: string }>;
}

export interface EventRecord {
  id: string;
  sessionId: string;
  runId: string | null;
  seq: number;
  type: string;
  payloadJson: Record<string, unknown>;
  createdAt: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'FILE' | 'DIRECTORY' | 'SYMLINK';
  blocked?: boolean;
  children?: FileEntry[];
}

export interface PromptRecord {
  id: string;
  projectId: string | null;
  key: string;
  name: string;
  description: string | null;
  kind: string;
  type: 'TEXT' | 'CHAT';
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersionRecord {
  id: string;
  promptId: string;
  version: number;
  contentJson: Record<string, unknown>;
  variablesJson: Record<string, unknown>;
  configJson: Record<string, unknown>;
  changelog: string | null;
  source: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
}

export interface PromptLabelRecord {
  promptId: string;
  label: string;
  versionId: string;
  version: number;
  updatedAt: string;
}

export interface PromptBindingRecord {
  id: string;
  targetType: 'PROJECT' | 'AGENT' | 'TASK';
  targetId: string;
  slot: string;
  promptId: string;
  selectorType: 'LABEL' | 'VERSION';
  label: string | null;
  versionId: string | null;
  priority: number;
  enabled: boolean;
}

export interface RenderedPromptRecord {
  promptId: string;
  promptKey: string;
  versionId: string;
  version: number;
  label: string | null;
  contentHash: string;
  content: Record<string, unknown>;
  text: string;
  missingVariables: string[];
}

export interface ResolvedPromptContextRecord {
  ready: boolean;
  finalContext: string;
  missingVariables: string[];
  items: Array<{
    bindingId: string;
    targetType: string;
    targetId: string;
    slot: string;
    priority: number;
    promptId: string;
    promptKey: string;
    promptName: string;
    label: string | null;
    versionId: string;
    version: number;
    contentHash: string;
    renderedText: string;
    missingVariables: string[];
  }>;
}

export interface SkillRecord {
  id: string;
  projectId: string | null;
  slug: string;
  name: string;
  description: string | null;
  source: string;
  rootPath: string;
  contentHash: string;
  enabled: boolean;
}

export interface SkillBindingRecord {
  id: string;
  skillId: string;
  targetType: 'PROJECT' | 'AGENT' | 'TASK';
  targetId: string;
  enabled: boolean;
  createdAt: string;
}
