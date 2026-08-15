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
  labelPromptType,
  labelRuntimeStatus,
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
  });
});
