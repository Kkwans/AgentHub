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
  VALIDATION_ERROR: '提交的数据不符合要求，请检查后重试。',
  NOT_FOUND: '请求的资源不存在。',
  INTERNAL_ERROR: '服务发生异常，请前往设置查看诊断信息。',
  AUTH_REQUIRED: '当前 Agent 需要完成授权。',
  WORKSPACE_UNMAPPED: 'Project 目录未映射到目标容器。',
  EXECUTION_TARGET_NOT_FOUND: 'Execution Target 不存在。',
  AGENT_NOT_FOUND: 'Agent 不存在。',
  PROJECT_NOT_FOUND: 'Project 不存在。',
  SESSION_NOT_FOUND: 'Session 不存在。',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
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
