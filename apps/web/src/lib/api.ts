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
  AUTH_REQUIRED: '请先登录 AgentHub。',
  AUTH_SETUP_REQUIRED: '请先创建管理员账号。',
  AUTH_SETUP_COMPLETED: '管理员账号已经创建，请直接登录。',
  AUTH_SETUP_NOT_REQUIRED: '当前为本地可信模式，不需要创建登录账号。',
  AUTH_LOGIN_NOT_REQUIRED: '当前为本地可信模式，不需要登录。',
  AUTH_INVALID_CREDENTIALS: '用户名或密码不正确。',
  AUTH_LOGIN_RATE_LIMITED: '登录尝试过多，请 15 分钟后重试。',
  AUTH_PASSWORD_LOGIN_REQUIRED: '请使用管理员账号登录后修改密码。',
  WORKSPACE_UNMAPPED: 'Project 目录未映射到目标容器。',
  EXECUTION_TARGET_NOT_FOUND: 'Execution Target 不存在。',
  AGENT_NOT_FOUND: 'Agent 不存在。',
  PROJECT_NOT_FOUND: 'Project 不存在。',
  PROJECT_NOT_ACTIVE: 'Project 当前不可用，请先恢复为 ACTIVE 状态。',
  SESSION_NOT_FOUND: 'Session 不存在。',
  SESSION_CWD_NOT_ABSOLUTE: '工作目录必须是绝对路径。',
  SESSION_CWD_NOT_FOUND: '工作目录不存在，请检查 Project root。',
  SESSION_CWD_OUTSIDE_PROJECT: '工作目录必须位于当前 Project root 内。',
  APPROVAL_DECISION_CONFLICT: '这个权限请求已经记录了其他决定，请刷新查看最新状态。',
  TASK_NOT_WAITING_REVIEW: '当前 Task 已不在待审阅状态，请刷新查看最新结果。',
  TASK_REWORK_FEEDBACK_REQUIRED: '请填写需要 Agent 继续修改的具体内容。',
  TASK_REWORK_AGENT_REQUIRED: '当前 Task 没有可继续执行的 Agent，请先重新分配。',
  PROJECT_NOT_GIT: '当前 Project 不是可用的 Git 仓库。',
  GIT_COMMIT_PATHS_REQUIRED: '请至少勾选一个需要提交的文件。',
  GIT_ADD_SELECTED_FAILED: '所选文件暂存失败，请刷新 Git 状态后重试。',
  GIT_COMMIT_FAILED: 'Git 提交失败，请检查提交说明、文件状态和 Git 配置。',
  GIT_DIFF_FAILED: 'Git Diff 读取失败，请刷新后重试。',
  GIT_LOG_FAILED: 'Git 提交历史读取失败，请刷新后重试。',
  GIT_BRANCHES_FAILED: 'Git 分支读取失败，请刷新后重试。',
  AGENT_NOT_READY: 'Agent 尚未预检就绪或已停用，请先前往 Agent 页面处理。',
  AGENT_PROJECT_TARGET_MISMATCH: 'Agent 与当前 Project 使用的 Execution Target 不一致。',
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
  REMOTE_NODE_NOT_FOUND: 'Remote Node 不存在。',
  REMOTE_NODE_OFFLINE: 'Remote Node 当前离线，请检查 daemon 与网络连接。',
  REMOTE_NODE_REVOKED: 'Remote Node 设备身份已撤销。',
  REMOTE_NODE_ROOT_INVALID: 'Node root 包含非法字符。',
  REMOTE_NODE_ROOT_NOT_ABSOLUTE: 'Node root 必须使用绝对路径。',
  REMOTE_NODE_ROOT_TOO_BROAD: 'Node root 不能授权整个文件系统根目录。',
  REMOTE_NODE_ROOT_REQUIRED: '至少需要配置一个 Node root。',
  REMOTE_NODE_ROOTS_MISMATCH: 'Node daemon 的 roots 与注册码授权范围不一致。',
  REMOTE_NODE_REGISTRATION_TOKEN_USED: 'Remote Node 注册码已经使用。',
  REMOTE_NODE_REGISTRATION_TOKEN_EXPIRED: 'Remote Node 注册码已经过期。',
  REMOTE_AGENT_NOT_AVAILABLE: 'Remote Node inventory 中没有可用的该类型 Agent。',
  REMOTE_CUSTOM_AGENT_UNSUPPORTED: 'Remote Node 只允许 inventory 中的固定 Agent Profile。',
  REMOTE_GIT_UNSUPPORTED: 'v0.2 暂不提供 Remote Node Git 控制接口。',
};

const authorizationRequiredEvent = 'agenthub:authorization-required';

export const authSession = {
  onAuthorizationRequired(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(authorizationRequiredEvent, listener);
    return () => window.removeEventListener(authorizationRequiredEvent, listener);
  },
  notifyAuthorizationRequired(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(authorizationRequiredEvent));
  },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json()) as SuccessEnvelope<T> | ErrorEnvelope;
  if (!response.ok || 'error' in body) {
    const error = 'error' in body ? body.error : { code: 'HTTP_ERROR', message: '请求失败' };
    if (error.code === 'AUTH_REQUIRED') {
      authSession.notifyAuthorizationRequired();
    }
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
  capabilitiesJson: Record<string, unknown>;
  connectionJson: Record<string, unknown>;
  lastSeenAt: string | null;
}

export interface RemoteAgentInventoryRecord {
  key: string;
  name: string;
  agentKind: string;
  adapterKind: string;
  status: 'AVAILABLE' | 'MISSING' | 'BROKEN';
  detectedVersion?: string;
  capabilities: {
    sessions: boolean;
    streaming: boolean;
    approvals: boolean;
    files: boolean;
    terminal: boolean;
  };
}

export interface RemoteNodeRecord {
  id: string;
  targetId: string;
  name: string;
  hostname: string;
  os: string;
  arch: string;
  fingerprint: string;
  protocolVersion: string;
  daemonVersion: string;
  allowedRootsJson: string[];
  inventoryJson: RemoteAgentInventoryRecord[];
  status: 'ONLINE' | 'OFFLINE' | 'REVOKED';
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteNodeRegistration {
  id: string;
  name: string;
  allowedRoots: string[];
  expiresAt: string;
  createdAt: string;
  token: string;
}

export interface RemoteNodeDiagnostics {
  id: string;
  targetId: string;
  status: 'ONLINE' | 'OFFLINE' | 'REVOKED';
  connected: boolean;
  fingerprint: string;
  protocolVersion: string;
  daemonVersion: string;
  allowedRoots: string[];
  inventory: RemoteAgentInventoryRecord[];
  lastSeenAt: string | null;
  revokedAt: string | null;
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
  enabled: boolean;
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
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED' | 'EXPIRED';
  optionsJson: Array<{ id?: string; label?: string; kind?: string }>;
  selectedOptionId: string | null;
  deliveryId: string | null;
  deliveryState:
    'QUEUED' | 'CLAIMED' | 'DISPATCHING' | 'RETRY_WAIT' | 'DELIVERED' | 'UNKNOWN' | 'DEAD' | null;
  deliveryAttemptCount: number | null;
  deliveryErrorCode: string | null;
  deliveryErrorMessage: string | null;
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
