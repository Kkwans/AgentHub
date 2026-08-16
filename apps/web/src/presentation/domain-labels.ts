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

/**
 * Event types are an internal normalized contract. Keep the protocol value out
 * of the normal conversation view; the debug view can still expose it when a
 * technical diagnosis needs the exact wire name.
 */
export const AGENT_EVENT_TYPE_LABELS = {
  'session.created': 'Session 已创建',
  'session.state_changed': 'Session 状态更新',
  'session.closed': 'Session 已关闭',
  'run.started': 'Run 已开始',
  'run.completed': 'Run 已完成',
  'run.failed': 'Run 失败',
  'run.cancelled': 'Run 已停止',
  'assistant.message.delta': 'Agent 回复更新',
  'assistant.message.completed': 'Agent 回复完成',
  'agent.plan.updated': 'Agent 执行计划更新',
  'agent.status': 'Agent 状态更新',
  'tool.call.started': '工具调用开始',
  'tool.call.progress': '工具调用进行中',
  'tool.call.completed': '工具调用完成',
  'tool.call.failed': '工具调用失败',
  'approval.requested': '请求批准',
  'approval.resolved': '批准已处理',
  'file.changed': '文件已变更',
  'git.status.changed': 'Git 状态更新',
  'usage.updated': '用量更新',
  'artifact.created': '产物已创建',
  'adapter.warning': '适配器提醒',
  'adapter.disconnected': 'Agent 连接中断',
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

export type WorkspaceRunState =
  'IDLE' | 'RUNNING' | 'WAITING_APPROVAL' | 'CANCELING' | 'DISCONNECTED' | 'FAILED' | 'CLOSED';

export const WORKSPACE_RUN_STATE_COPY: Record<
  WorkspaceRunState,
  { title: string; description: string }
> = {
  IDLE: {
    title: '可以开始',
    description: '在下方写下下一步，Agent 会在当前 Project 中执行。',
  },
  RUNNING: {
    title: 'Agent 正在执行',
    description: '实时消息和工具进度会出现在对话中，输入框会暂时锁定。',
  },
  WAITING_APPROVAL: {
    title: '等待你的批准',
    description: '请查看下方 Approval 请求，只选择 Agent 提供的合法选项。',
  },
  CANCELING: {
    title: '正在停止 Run',
    description: '正在等待 Agent 收尾，完成后可以继续发送新的指令。',
  },
  DISCONNECTED: {
    title: 'Agent 连接已中断',
    description: '当前会话不能继续运行。可以先恢复 Session，或返回列表重新开始。',
  },
  FAILED: {
    title: '最近一次 Run 失败',
    description: '查看对话和运行记录后，可以发送新的指令重试。',
  },
  CLOSED: {
    title: 'Session 已关闭',
    description: '历史记录仍可查看，但已关闭的 Session 不能继续发送指令。',
  },
};

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

export function labelAgentEventType(value: string | null | undefined) {
  return labelFrom(AGENT_EVENT_TYPE_LABELS, value, '执行事件');
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

export function resolveWorkspaceRunState(
  sessionStatus: string | null | undefined,
  activeRunStatus?: string | null,
  latestRunStatus?: string | null,
): WorkspaceRunState {
  const currentRunStatus =
    activeRunStatus ??
    latestRunStatus ??
    (sessionStatus &&
    ['QUEUED', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING'].includes(sessionStatus)
      ? sessionStatus
      : undefined);
  if (currentRunStatus === 'WAITING_APPROVAL') return 'WAITING_APPROVAL';
  if (currentRunStatus === 'CANCELING') return 'CANCELING';
  if (currentRunStatus && ['QUEUED', 'STARTING', 'RUNNING'].includes(currentRunStatus)) {
    return 'RUNNING';
  }
  if (sessionStatus === 'DISCONNECTED' || currentRunStatus === 'DISCONNECTED') {
    return 'DISCONNECTED';
  }
  if (sessionStatus === 'FAILED' || currentRunStatus === 'FAILED') {
    return 'FAILED';
  }
  if (sessionStatus === 'CLOSED') return 'CLOSED';
  return 'IDLE';
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
