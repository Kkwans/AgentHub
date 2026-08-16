import { describe, expect, it } from 'vitest';

import {
  ADAPTER_KIND_LABELS,
  AGENT_EVENT_TYPE_LABELS,
  AGENT_KIND_LABELS,
  AGENT_STATUS_LABELS,
  APPROVAL_STATUS_LABELS,
  EXECUTION_TARGET_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  PROMPT_KIND_LABELS,
  PROMPT_TYPE_LABELS,
  RUN_STATUS_LABELS,
  TASK_STATUS_LABELS,
  WORKTREE_STATUS_LABELS,
  labelAgentKind,
  labelAgentEventType,
  labelExecutionTargetKind,
  labelPromptKind,
  labelPromptPriority,
  labelPromptVersionCreator,
  labelPromptVersionSource,
  labelPromptType,
  labelSkillSource,
  labelRuntimeStatus,
  resolveWorkspaceRunState,
} from './domain-labels';

describe('domain presentation labels', () => {
  it('covers every supported enum value with a non-empty label', () => {
    const maps = [
      EXECUTION_TARGET_KIND_LABELS,
      AGENT_KIND_LABELS,
      ADAPTER_KIND_LABELS,
      AGENT_EVENT_TYPE_LABELS,
      AGENT_STATUS_LABELS,
      PROJECT_STATUS_LABELS,
      PROMPT_KIND_LABELS,
      PROMPT_TYPE_LABELS,
      RUN_STATUS_LABELS,
      TASK_STATUS_LABELS,
      APPROVAL_STATUS_LABELS,
      WORKTREE_STATUS_LABELS,
    ];
    for (const map of maps) {
      for (const label of Object.values(map)) expect(label.trim()).not.toBe('');
    }
  });

  it('does not leak raw enum values for normal presentation', () => {
    expect(labelExecutionTargetKind('DOCKER_CONTAINER')).toBe('Docker 容器');
    expect(labelAgentKind('CLAUDE_CODE')).toBe('Claude Code');
    expect(labelPromptKind('REVIEW')).toBe('审阅提示');
    expect(labelPromptType('CHAT')).toBe('对话消息');
    expect(labelPromptType('UNSUPPORTED')).toBe('内容格式');
    expect(labelRuntimeStatus('WORKSPACE_UNMAPPED')).toBe('工作区未映射');
    expect(labelAgentEventType('tool.call.completed')).toBe('工具调用完成');
    expect(labelAgentEventType('vendor.private.event')).toBe('执行事件');
    expect(labelPromptVersionSource('PROJECT_SCAN')).toBe('项目扫描');
    expect(labelPromptVersionCreator('local-user')).toBe('本机用户');
    expect(labelSkillSource('PROJECT_SCAN')).toBe('项目扫描');
    expect(labelPromptPriority(0)).toBe('默认顺序');
    expect(labelPromptPriority(-5)).toBe('更优先（-5）');
    expect(labelPromptPriority(5)).toBe('较后执行（+5）');
  });

  it('将 Session 与 Run 状态收敛为普通用户可理解的 Workspace 状态', () => {
    expect(resolveWorkspaceRunState('READY')).toBe('IDLE');
    expect(resolveWorkspaceRunState('RUNNING', 'RUNNING')).toBe('RUNNING');
    expect(resolveWorkspaceRunState('RUNNING')).toBe('RUNNING');
    expect(resolveWorkspaceRunState('RUNNING', undefined, 'QUEUED')).toBe('RUNNING');
    expect(resolveWorkspaceRunState('WAITING_APPROVAL', 'WAITING_APPROVAL')).toBe(
      'WAITING_APPROVAL',
    );
    expect(resolveWorkspaceRunState('READY', 'CANCELING')).toBe('CANCELING');
    expect(resolveWorkspaceRunState('DISCONNECTED')).toBe('DISCONNECTED');
    expect(resolveWorkspaceRunState('READY', undefined, 'FAILED')).toBe('FAILED');
    expect(resolveWorkspaceRunState('CLOSED')).toBe('CLOSED');
  });
});
