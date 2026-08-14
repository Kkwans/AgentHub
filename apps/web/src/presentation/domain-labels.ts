export const EXECUTION_TARGET_KIND_LABELS = {
  LOCAL_HOST: 'AgentHub 运行环境',
  DOCKER_CONTAINER: 'Docker 容器',
  REMOTE_NODE: '远程节点',
} as const;

export const AGENT_KIND_LABELS = {
  CODEX: 'Codex',
  CLAUDE_CODE: 'Claude Code',
  OPENCODE: 'OpenCode',
  HERMES: 'Hermes',
  OPENCLAW: 'OpenClaw',
  CUSTOM_ACP: 'Custom ACP',
} as const;

export const ADAPTER_KIND_LABELS = {
  ACP: 'ACP',
  OPENCLAW_ACP: 'OpenClaw ACP',
  OPENCLAW_EXEC: 'OpenClaw Agent exec',
  CUSTOM_ACP: 'Custom ACP',
} as const;

export const PROMPT_KIND_LABELS = {
  SYSTEM: '系统提示',
  TASK: '任务提示',
  REVIEW: '审阅提示',
  COMMIT: '提交提示',
  RULE: '规则',
  TEMPLATE: '模板',
} as const;

export const PROMPT_TYPE_LABELS = {
  TEXT: '文本',
  CHAT: '对话消息',
} as const;

export const PROMPT_BINDING_TARGET_LABELS = {
  PROJECT: 'Project',
  AGENT: 'Agent',
  TASK: 'Task',
} as const;

export const PROMPT_BINDING_SLOT_LABELS = {
  SYSTEM: '系统提示',
  TASK_PRIMER: '任务前置',
  REVIEW: '审阅',
  COMMIT: '提交',
  RULES: '规则',
} as const;

export const PROMPT_SELECTOR_LABELS = {
  LABEL: '标签',
  VERSION: '固定版本',
} as const;

export const PROJECT_STATUS_LABELS = {
  ACTIVE: '使用中',
  ARCHIVED: '已归档',
  BROKEN: '需要处理',
} as const;

export const AGENT_STATUS_LABELS = {
  READY: '就绪',
  AUTH_REQUIRED: '需要登录',
  MISSING: '未安装',
  BROKEN: '需要修复',
  STOPPED: '已停止',
  DISABLED: '已停用',
} as const;

export const RUNTIME_STATUS_LABELS = {
  READY: '可用',
  STOPPED: '已停止',
  STARTING: '正在启动',
  UNHEALTHY: '健康检查失败',
  WORKSPACE_UNMAPPED: '工作区未映射',
  OFFLINE: '离线',
  UNAVAILABLE: '不可用',
  UNSUPPORTED: '不支持',
  BROKEN: '需要修复',
} as const;

export const DISCOVERY_STATUS_LABELS = {
  READY: '就绪',
  AUTH_REQUIRED: '需要登录',
  INSTALLED: '已发现',
  MISSING_DEPENDENCY: '缺少依赖',
  STOPPED: '运行环境已停止',
  UNSUPPORTED: '暂不支持',
  BROKEN: '需要修复',
} as const;

export const TASK_STATUS_LABELS = {
  BACKLOG: '待规划',
  READY: '待执行',
  IN_PROGRESS: '进行中',
  WAITING_REVIEW: '待审阅',
  DONE: '已完成',
  BLOCKED: '受阻',
  CANCELED: '已取消',
} as const;

export const RUN_STATUS_LABELS = {
  IDLE: '未运行',
  RUNNING: '运行中',
  WAITING_APPROVAL: '等待批准',
  CANCELING: '正在停止',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELED: '已停止',
  DISCONNECTED: '连接中断',
} as const;

export const APPROVAL_STATUS_LABELS = {
  PENDING: '等待你的决定',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
  CANCELED: '已取消',
  EXPIRED: '已过期',
} as const;

export const WORKTREE_STATUS_LABELS = {
  QUEUED: '排队中',
  SETTING_UP: '准备工作区',
  RUNNING: '运行中',
  AWAITING_INPUT: '等待输入',
  REVIEW: '待审阅',
  MERGING: '正在合并',
  DONE: '已完成',
  BLOCKED: '受阻',
  CANCELED: '已取消',
} as const;

type LabelMap = Record<string, string>;

function labelFrom(map: LabelMap, value: string | null | undefined, fallback = '状态待确认') {
  if (!value) return fallback;
  return map[value] ?? fallback;
}

export function labelExecutionTargetKind(value: string | null | undefined) {
  return labelFrom(EXECUTION_TARGET_KIND_LABELS, value, '执行环境');
}

export function labelAgentKind(value: string | null | undefined) {
  return labelFrom(AGENT_KIND_LABELS, value, 'Agent');
}

export function labelAdapterKind(value: string | null | undefined) {
  return labelFrom(ADAPTER_KIND_LABELS, value, '协议适配器');
}

export function labelPromptKind(value: string | null | undefined) {
  return labelFrom(PROMPT_KIND_LABELS, value, '提示用途');
}

export function labelPromptType(value: string | null | undefined) {
  return labelFrom(PROMPT_TYPE_LABELS, value, '内容格式');
}

export function labelPromptBindingTarget(value: string | null | undefined) {
  return labelFrom(PROMPT_BINDING_TARGET_LABELS, value, '绑定目标');
}

export function labelPromptBindingSlot(value: string | null | undefined) {
  return labelFrom(PROMPT_BINDING_SLOT_LABELS, value, '提示位');
}

export function labelPromptSelector(value: string | null | undefined) {
  return labelFrom(PROMPT_SELECTOR_LABELS, value, '选择方式');
}

export function labelProjectStatus(value: string | null | undefined) {
  return labelFrom(PROJECT_STATUS_LABELS, value);
}

export function labelAgentStatus(value: string | null | undefined) {
  return labelFrom(AGENT_STATUS_LABELS, value);
}

export function labelRuntimeStatus(value: string | null | undefined) {
  return labelFrom(RUNTIME_STATUS_LABELS, value, '运行环境状态待确认');
}

export function labelDiscoveryStatus(value: string | null | undefined) {
  return labelFrom(DISCOVERY_STATUS_LABELS, value, '发现状态待确认');
}

export function labelTaskStatus(value: string | null | undefined) {
  return labelFrom(TASK_STATUS_LABELS, value);
}

export function labelRunStatus(value: string | null | undefined) {
  return labelFrom(RUN_STATUS_LABELS, value);
}

export function labelApprovalStatus(value: string | null | undefined) {
  return labelFrom(APPROVAL_STATUS_LABELS, value);
}

export function labelWorktreeStatus(value: string | null | undefined) {
  return labelFrom(WORKTREE_STATUS_LABELS, value);
}

export const RAW_ENUM_ALLOWLIST_FOR_DEBUG = [
  'LOCAL_HOST',
  'DOCKER_CONTAINER',
  'REMOTE_NODE',
  'SYSTEM',
  'TASK',
  'REVIEW',
  'COMMIT',
  'RULE',
  'TEMPLATE',
  'TEXT',
  'CHAT',
] as const;
