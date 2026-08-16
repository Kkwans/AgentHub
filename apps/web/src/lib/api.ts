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
  AUTH_MODE_REQUIRED: '当前服务模式需要登录。',
  INVALID_SERVER_PORT: '服务端口配置无效，请检查部署设置。',
  INSECURE_NON_LOOPBACK_BIND: '非本机访问必须启用 token 认证。',
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
  APPROVAL_ALREADY_RESOLVED: '这个权限请求已经被其他操作处理，请刷新查看最新状态。',
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
  REMOTE_WORKTREE_NOT_AVAILABLE:
    '当前 Remote Node 不支持隔离 Worktree，请改用普通 Session，或在本机 Git Project 中执行隔离任务。',
  REMOTE_NODE_NOT_FOUND: 'Remote Node 不存在。',
  REMOTE_NODE_OFFLINE: 'Remote Node 当前离线，请检查 daemon 与网络连接。',
  REMOTE_NODE_REVOKED: 'Remote Node 设备身份已撤销。',
  REMOTE_NODE_ROOT_INVALID: 'Node root 包含非法字符。',
  REMOTE_NODE_ROOT_NOT_ABSOLUTE: 'Node root 必须使用绝对路径。',
  REMOTE_NODE_ROOT_TOO_BROAD: 'Node root 不能授权整个文件系统根目录。',
  REMOTE_NODE_ROOT_REQUIRED: '至少需要配置一个 Node root。',
  REMOTE_NODE_ROOTS_MISMATCH: 'Node daemon 的 roots 与注册码授权范围不一致。',
  RUNTIME_CANDIDATE_NOT_FOUND: 'Runtime 候选不存在，请重新扫描。',
  RUNTIME_CANDIDATE_NOT_ADOPTABLE: '当前 Runtime 不能接管，请先处理其状态。',
  RUNTIME_CANDIDATE_INVALID: 'Runtime 候选信息不完整，请重新扫描。',
  RUNTIME_NOT_ADOPTED: '请先接管 Runtime。',
  DOCKER_ENGINE_UNAVAILABLE: 'Docker Engine 当前不可用，请检查 Docker 服务与权限。',
  DOCKER_CONTAINER_UNHEALTHY: 'Docker 容器健康检查未通过，请查看容器日志。',
  DOCKER_INSPECT_INVALID: 'Docker 返回了无法识别的容器信息。',
  DOCKER_TARGET_FIELDS_REQUIRED: 'Docker Execution Target 缺少必要配置。',
  DOCKER_TARGET_HAS_ACTIVE_SESSIONS: 'Docker 容器仍有活动 Session，请先停止相关运行。',
  AGENT_CANDIDATE_NOT_FOUND: 'Agent 候选不存在，请重新扫描。',
  AGENT_CANDIDATE_NOT_ADOPTABLE: '当前 Agent 不能接入，请先处理运行环境状态。',
  AGENT_PROFILE_NOT_DETECTED: '尚未识别出支持的 Agent。',
  REMOTE_FILESYSTEM_UNSUPPORTED: 'Remote Node 文件浏览暂不可用，请检查 Node 连接。',
  FILESYSTEM_ROOT_NOT_FOUND: '文件根目录不存在或当前无权访问。',
  SYMLINK_ESCAPE: '该目录链接超出允许范围，已阻止访问。',
  REMOTE_NODE_REGISTRATION_TOKEN_USED: 'Remote Node 注册码已经使用。',
  REMOTE_NODE_REGISTRATION_TOKEN_EXPIRED: 'Remote Node 注册码已经过期。',
  REMOTE_AGENT_NOT_AVAILABLE: 'Remote Node inventory 中没有可用的该类型 Agent。',
  REMOTE_CUSTOM_AGENT_UNSUPPORTED: 'Remote Node 只允许 inventory 中的固定 Agent Profile。',
  REMOTE_GIT_UNSUPPORTED: '当前 Remote Node 不支持 Git 控制，请在 Project 所在设备上完成 Git 操作。',
  REMOTE_NODE_GATEWAY_UNAVAILABLE: 'Remote Node 通道暂不可用，请检查 Node 连接。',
  REMOTE_NODE_OPERATION_FAILED: 'Remote Node 操作失败，请检查连接与授权目录。',
  REMOTE_NODE_RPC_FAILED: 'Remote Node 请求失败，请检查连接后重试。',
  REMOTE_AGENT_CONFIG_INVALID: 'Remote Node Agent 配置不完整，请重新接入。',
  REMOTE_NODE_ALREADY_AUTHENTICATED: 'Remote Node 已完成授权，请刷新状态。',
  REMOTE_NODE_ALREADY_CONNECTED: 'Remote Node 已连接，请勿重复接入。',
  REMOTE_NODE_AUTH_REQUIRED: 'Remote Node 需要重新授权，请检查注册码。',
  REMOTE_NODE_CHALLENGE_EXPIRED: 'Remote Node 授权挑战已过期，请重新生成注册码。',
  REMOTE_NODE_GATEWAY_ERROR: 'Remote Node 通道发生错误，请检查 Node 日志。',
  REMOTE_NODE_ID_MISMATCH: 'Remote Node 身份不匹配，请重新接入正确设备。',
  REMOTE_NODE_INVALID_JSON: 'Remote Node 返回了无效数据，请检查 Node 版本。',
  REMOTE_NODE_MESSAGE_INVALID: 'Remote Node 返回了无法识别的消息，请检查 Node 版本。',
  REMOTE_NODE_PUBLIC_KEY_INVALID: 'Remote Node 公钥无效，请重新接入设备。',
  REMOTE_NODE_SIGNATURE_INVALID: 'Remote Node 身份校验失败，请重新接入设备。',
  AGENT_CONFIG_INVALID: 'Agent 配置不完整，请重新检查接入状态。',
  AGENT_EXECUTABLE_NOT_ABSOLUTE: 'Agent 启动程序路径必须是绝对路径。',
  AGENT_EXECUTABLE_REQUIRED: '该 Agent 缺少启动程序配置。',
  AGENT_KIND_INVALID: 'Agent 类型不受支持。',
  AGENT_RUN_START_FAILED: 'Agent Run 启动失败，请查看 Agent 诊断。',
  AGENT_SESSION_CREATE_FAILED: 'Agent Session 创建失败，请先完成 preflight。',
  AGENT_SESSION_RESUME_FAILED: 'Agent Session 恢复失败，请重新检查连接。',
  AGENT_TARGET_CONFIG_INVALID: 'Agent 的执行环境配置不完整。',
  AGENT_TARGET_KIND_UNSUPPORTED: '当前执行环境不支持该 Agent。',
  AGENT_TARGET_MISSING: 'Agent 绑定的执行环境不存在。',
  APPROVAL_NOT_FOUND: '权限请求不存在或已经结束。',
  APPROVAL_OPTION_INVALID: 'Agent 返回的权限选项无法识别。',
  BINARY_FILE_UNSUPPORTED: '二进制文件不提供文本预览。',
  CONTAINER_REPLACED: '容器身份已经变化，请重新扫描并接入。',
  CWD_NOT_ABSOLUTE: '工作目录必须使用绝对路径。',
  DOCKER_CONTAINER_NOT_FOUND: '已接入的 Docker 容器不存在。',
  DOCKER_CONTAINER_STOPPED: 'Docker 容器已停止，请先启动运行环境。',
  DOCKER_ENGINE_INVALID: 'Docker Engine 返回了无法识别的状态。',
  DOCKER_START_FAILED: 'Docker 容器启动失败。',
  DOCKER_STOP_FAILED: 'Docker 容器停止失败。',
  DOCKER_TARGET_CONFIG_INVALID: 'Docker 运行环境配置不完整。',
  EVENT_STORE_UNAVAILABLE: '事件记录暂时不可用，请稍后重试。',
  EXECUTION_TARGET_NOT_DOCKER: '当前 Execution Target 不是 Docker 容器。',
  FILE_NOT_DIRECTORY: '选择的路径不是目录。',
  FILE_NOT_FOUND: '文件或目录不存在。',
  FILE_NOT_REGULAR: '该路径不是普通文件。',
  FILE_TOO_LARGE: '文件过大，暂不提供浏览器预览。',
  FILE_TREE_TOO_LARGE: '目录内容过多，请缩小浏览范围。',
  GOAL_NOT_FOUND: 'Goal 不存在或已被移除。',
  GOAL_PARENT_PROJECT_MISMATCH: 'Goal 所属 Project 与当前选择不一致。',
  INVALID_GOAL_STATE_TRANSITION: 'Goal 当前状态不能执行此操作。',
  HEALTH_CHECK_FAILED: '服务健康检查未通过。',
  INVALID_AGENT_COMMAND: 'Agent 命令不合法。',
  INVALID_APPROVAL_DELIVERY_TIMEOUT_MS: '权限请求超时时间配置无效。',
  INVALID_CONTAINER_NAME: 'Docker 容器名称不合法。',
  INVALID_CONTAINER_ID: 'Docker 容器身份无效，请重新扫描。',
  INVALID_RUN_CANCEL_TIMEOUT_MS: 'Run 取消超时时间配置无效。',
  INVALID_WORKSPACE_MAPPING: '工作区映射配置无效，请检查路径。',
  OPENCLAW_EXEC_PROFILE_INVALID: 'OpenClaw 执行配置不完整，请重新预检。',
  GIT_BRANCH_INVALID: 'Git 分支名称无效，请重新输入。',
  PATH_ABSOLUTE_FORBIDDEN: '路径不能越过当前 Project 根目录。',
  PATH_ENCODING_INVALID: '路径编码无效，请重新选择目录。',
  PATH_INVALID: '路径格式无效，请重新选择目录。',
  PATH_TRAVERSAL: '路径包含越界访问，已被阻止。',
  PROJECT_PREFLIGHT_FAILED: 'Project 预检未通过，请处理检查项后重试。',
  PROJECT_TARGET_MISSING: 'Project 绑定的执行环境不存在。',
  PROMPT_BINDING_NOT_FOUND: 'Prompt 绑定不存在或已被移除。',
  PROMPT_BINDING_SELECTOR_INVALID: 'Prompt 绑定的版本来源无效。',
  PROMPT_CHAT_CONTENT_INVALID: '对话消息内容不是有效 JSON。',
  PROMPT_CHAT_MESSAGE_INVALID: 'CHAT Prompt 消息格式无效。',
  PROMPT_TEXT_CONTENT_INVALID: 'Prompt 文本内容无效。',
  PROMPT_VARIABLE_UNDECLARED: 'Prompt 使用了未声明的变量。',
  PROMPT_VARIABLE_SCHEMA_INVALID: 'Prompt 变量定义无效，请检查变量 schema。',
  ROUTE_NOT_FOUND: '请求的页面或接口不存在。',
  SKILL_BINDING_TARGET_NOT_FOUND: 'Skill 绑定目标不存在。',
  SKILL_NOT_FOUND: 'Skill 不存在或已被移除。',
  RUN_NOT_CANCELABLE: '当前 Run 已不能停止。',
  RUN_NOT_FOUND: 'Run 不存在或已被移除。',
  SESSION_HAS_ACTIVE_RUN: 'Session 仍有运行中的 Run，请先停止它。',
  SESSION_NOT_CONNECTED: 'Session 当前未连接 Agent。',
  SESSION_NOT_DISCONNECTED: 'Session 当前不处于可恢复状态。',
  SESSION_NOT_READY: 'Session 尚未准备好运行。',
  SESSION_NOT_RESUMABLE: 'Session 当前不能恢复。',
  TASK_NOT_FOUND: 'Task 不存在或已被移除。',
  TASK_GOAL_PROJECT_MISMATCH: 'Task、Goal 与 Project 的归属不一致。',
  TASK_PARENT_PROJECT_MISMATCH: 'Task 所属 Project 与当前选择不一致。',
  TASK_NOT_READY: 'Task 当前还不能开始执行。',
  TERMINAL_NOT_FOUND: 'Terminal 不存在或已关闭。',
  TERMINAL_SHELL_MISSING: 'Terminal Shell 不可用。',
  TERMINAL_SHELL_NOT_ABSOLUTE: 'Terminal Shell 配置必须是绝对路径。',
  TERMINAL_SHELL_NOT_ALLOWED: 'Terminal Shell 不在允许列表内。',
  WORKSPACE_MAPPING_ESCAPE: '工作区映射超出允许范围，已被阻止。',
  WORKSPACE_MAPPING_STALE: '容器实际挂载已变化，请重新扫描运行环境。',
  WORKTREE_DIFF_FAILED: '隔离工作区 Diff 读取失败。',
  WORKTREE_EXECUTION_NOT_CANCELABLE: '当前隔离执行不能取消。',
  WORKTREE_BRANCH_CHECK_FAILED: '隔离工作区分支检查失败，请刷新后重试。',
  WORKTREE_IDENTITY_MISMATCH: '隔离工作区身份已变化，请重新创建。',
  WORKTREE_NOT_FOUND: '隔离工作区不存在或已被移除。',
  WORKTREE_PATH_EXISTS: '隔离工作区目录已存在。',
  WORKTREE_PATH_SEGMENT_INVALID: '隔离工作区路径包含无效片段。',
  WORKTREE_ROOT_NOT_ABSOLUTE: '隔离工作区根目录必须是绝对路径。',
  WORKTREE_RUNNER_STOPPING: '隔离执行器正在停止，请稍后重试。',
  WORKTREE_STAGE_CHECK_FAILED: '隔离工作区暂存检查失败，请刷新后重试。',
  WORKTREE_TASK_BRANCH_EXISTS: 'Task 分支已经存在，请刷新后重试。',
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
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    // Keep browser/network implementation details out of ordinary-user copy.
    // The diagnostic view can still use the request log and request id.
    throw new ApiError('HTTP_ERROR', errorMessages.HTTP_ERROR ?? '请求失败，请稍后重试。', 0);
  }

  let body: SuccessEnvelope<T> | ErrorEnvelope;
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid response envelope');
    body = parsed as SuccessEnvelope<T> | ErrorEnvelope;
  } catch {
    throw new ApiError(
      'HTTP_ERROR',
      errorMessages.HTTP_ERROR ?? '请求失败，请稍后重试。',
      response.status,
    );
  }
  if (!response.ok || 'error' in body) {
    const error = 'error' in body ? body.error : { code: 'HTTP_ERROR', message: '请求失败' };
    if (error.code === 'AUTH_REQUIRED') {
      authSession.notifyAuthorizationRequired();
    }
    throw new ApiError(
      error.code,
      errorMessages[error.code] ?? '请求失败，请查看设置中的诊断信息。',
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

export type RuntimeCandidateState = 'READY' | 'STOPPED' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'BROKEN';

export interface RuntimeCandidateRecord {
  candidateId: string;
  kind: 'LOCAL_HOST' | 'DOCKER_CONTAINER';
  displayName: string;
  state: RuntimeCandidateState;
  targetId?: string;
  containerId?: string;
  image?: string;
  statusText?: string;
  workspaceMappings: Array<{ hostRoot: string; containerRoot: string }>;
  adoptable: boolean;
  reasonCode?: string;
}

export type AgentCandidateState =
  | 'READY'
  | 'AUTH_REQUIRED'
  | 'INSTALLED'
  | 'MISSING_DEPENDENCY'
  | 'STOPPED'
  | 'UNSUPPORTED'
  | 'BROKEN';

export interface AgentCandidateRecord {
  candidateId: string;
  agentKind: string;
  displayName: string;
  targetCandidateId: string;
  targetId?: string;
  state: AgentCandidateState;
  adapterKind: string;
  detectedVersion?: string;
  inventoryKey?: string;
  reasonCode?: string;
  registeredAgentId?: string;
  adoptable: boolean;
}

export interface WorkspaceRootRecord {
  rootId: string;
  label: string;
  path: string;
  targetId: string;
  source: 'CONFIGURED' | 'DOCKER_MOUNT' | 'REMOTE_NODE';
}

export interface DirectoryEntryRecord {
  name: string;
  path: string;
  type: 'DIRECTORY' | 'SYMLINK' | 'FILE';
  accessible: boolean;
}

export interface DirectoryListingRecord {
  root: WorkspaceRootRecord;
  path: string;
  entries: DirectoryEntryRecord[];
}

export interface ProjectCandidateRecord {
  name: string;
  rootPath: string;
  relativePath: string;
  markers: string[];
  git: boolean;
  packageManagers: string[];
  readable: boolean;
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
