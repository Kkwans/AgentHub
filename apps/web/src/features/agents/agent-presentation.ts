import type { AgentRecord } from '../../lib/api';

export function agentKindLabel(kind: string): string {
  return { CODEX: 'Codex', CLAUDE_CODE: 'Claude Code', OPENCLAW: 'OpenClaw' }[kind] ?? 'Agent';
}

export function executionTargetKindLabel(kind: string | undefined): string {
  if (kind === 'LOCAL_HOST') return '本机';
  if (kind === 'DOCKER_CONTAINER') return 'Docker';
  if (kind === 'REMOTE_NODE') return '远程节点';
  return '类型待确认';
}

export function capabilitiesFor(agent: Pick<AgentRecord, 'capabilitiesJson'>): string[] {
  const labels: Record<string, string> = {
    session: 'Session',
    sessions: 'Session',
    run: 'Run',
    runs: 'Run',
    approval: 'Approval',
    approvals: 'Approval',
    files: '文件',
    terminal: 'Terminal',
    git: 'Git',
  };
  const capabilities = agent.capabilitiesJson ?? {};
  const confirmed = Object.entries(capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => labels[key.toLowerCase()])
    .filter((label): label is string => Boolean(label));
  // Current adapter contract is nested; an object (including all-false fields)
  // is not evidence of support. Only exact, recognized true flags count.
  const flag = (group: string, key: string) => {
    const value = capabilities[group];
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>)[key] === true
    );
  };
  if (flag('sessions', 'create')) confirmed.push('Session');
  if (flag('prompts', 'text')) confirmed.push('文本输入');
  if (flag('interaction', 'approvals')) confirmed.push('Approval');
  if (flag('workspace', 'files')) confirmed.push('文件');
  if (flag('workspace', 'terminal')) confirmed.push('Terminal');
  return Array.from(new Set(confirmed));
}
