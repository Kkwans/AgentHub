export const eligibilityReasons: Record<string, string> = {
  DISABLED: '已禁用',
  NOT_READY: '尚未就绪',
  TARGET_MISSING: '执行环境不存在',
  PROJECT_TARGET_MISSING: '项目执行环境不存在',
  PROJECT_INACTIVE: '项目未启用',
  INCOMPATIBLE_WORKSPACE: '无法访问项目工作区',
  REMOTE_GATEWAY_UNAVAILABLE: '远程网关不可用',
};
export type EligibilityEntry = {
  agentId: string;
  eligible: boolean;
  reason: string | null;
  agentStatus: string;
  targetStatus: string | null;
};
export function parseEligibility(value: unknown, projectId: string): EligibilityEntry[] {
  const data = value as {
    projectId?: unknown;
    basis?: unknown;
    livePreflight?: unknown;
    agents?: unknown;
  } | null;
  if (
    !data ||
    data.projectId !== projectId ||
    data.basis !== 'REGISTERED_STATE' ||
    data.livePreflight !== false ||
    !Array.isArray(data.agents)
  )
    throw new Error('项目 Agent 资格响应无法确认，请刷新后重试。');
  const ids = new Set<string>();
  for (const entry of data.agents) {
    if (
      !entry ||
      typeof entry.agentId !== 'string' ||
      !entry.agentId ||
      ids.has(entry.agentId) ||
      typeof entry.eligible !== 'boolean' ||
      typeof entry.agentStatus !== 'string' ||
      !(entry.targetStatus === null || typeof entry.targetStatus === 'string') ||
      (entry.eligible
        ? entry.reason !== null || entry.agentStatus !== 'READY' || entry.targetStatus === null
        : typeof entry.reason !== 'string' || !Object.hasOwn(eligibilityReasons, entry.reason))
    )
      throw new Error('项目 Agent 资格响应无法确认，请刷新后重试。');
    ids.add(entry.agentId);
  }
  return data.agents as EligibilityEntry[];
}
