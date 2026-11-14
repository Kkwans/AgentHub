import { describe, expect, it } from 'vitest';

import { mapAcpCapabilities } from './acp-adapter.js';
import { normalizeAcpSessionUpdate } from './normalization.js';

describe('ACP 事件归一化', () => {
  it('只输出安全的 tool 字段，并为已完成 edit 产生 file.changed', () => {
    const normalized = normalizeAcpSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      title: '编辑文件',
      kind: 'edit',
      status: 'completed',
      rawInput: { token: 'must-not-leak' },
      rawOutput: { secret: 'must-not-leak' },
      locations: [{ path: '/workspace/a.ts', line: 3 }],
    });

    expect(normalized.map((event) => event.type)).toEqual(['tool.call.completed', 'file.changed']);
    expect(JSON.stringify(normalized)).not.toContain('must-not-leak');
    expect(normalized[1]?.payload).toEqual({ toolCallId: 'tool-1', paths: ['/workspace/a.ts'] });
  });

  it('映射文本、Plan 与 Usage', () => {
    expect(
      normalizeAcpSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '你好' },
      })[0],
    ).toMatchObject({ type: 'assistant.message.delta', payload: { text: '你好' } });
    expect(
      normalizeAcpSessionUpdate({
        sessionUpdate: 'plan',
        entries: [{ content: '检查', priority: 'high', status: 'pending' }],
      })[0],
    ).toMatchObject({ type: 'agent.plan.updated' });
    expect(
      normalizeAcpSessionUpdate({ sessionUpdate: 'usage_update', used: 10, size: 100 })[0],
    ).toMatchObject({ type: 'usage.updated', payload: { used: 10, size: 100 } });
  });

  it('保留 ACP 思考文本及 messageId 供客户端流式聚合', () => {
    expect(
      normalizeAcpSessionUpdate({
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'thought-1',
        content: { type: 'text', text: '先检查布局约束。' },
      }),
    ).toEqual([
      {
        type: 'agent.thought.delta',
        payload: { text: '先检查布局约束。', messageId: 'thought-1' },
        sourceEventType: 'agent_thought_chunk',
      },
    ]);
  });

  it('将 ACP 配置通知归一化为 AgentHub 配置事件', () => {
    expect(
      normalizeAcpSessionUpdate({
        sessionUpdate: 'current_mode_update',
        currentModeId: 'plan',
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'agent.configuration.updated',
        payload: { current: { mode: 'plan' } },
      }),
    ]);
    expect(
      normalizeAcpSessionUpdate({
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'fixture-model',
            options: [{ value: 'fixture-model', name: 'Fixture Model' }],
          },
          {
            id: 'thought-level',
            name: 'Reasoning effort',
            category: 'thought_level',
            type: 'select',
            currentValue: 'high',
            options: [{ value: 'high', name: 'High' }],
          },
        ],
      }),
    ).toMatchObject([
      {
        type: 'agent.configuration.updated',
        payload: {
          current: { model: 'fixture-model' },
          options: {
            models: [{ id: 'fixture-model', label: 'Fixture Model' }],
            modes: [],
            reasoningEfforts: [{ id: 'high', label: 'High' }],
          },
        },
      },
    ]);
  });

  it('将 ACP 可用命令归一化为可供 Composer 使用的安全命令列表', () => {
    expect(
      normalizeAcpSessionUpdate({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'plan', description: 'Turn plan mode on.', input: null, _meta: { secret: true } },
          { name: '$lint', description: 'Run project lint', input: { hint: 'optional path' } },
        ],
      }),
    ).toEqual([
      {
        type: 'agent.commands.updated',
        payload: {
          commands: [
            { name: 'plan', description: 'Turn plan mode on.' },
            { name: '$lint', description: 'Run project lint', hint: 'optional path' },
          ],
        },
        sourceEventType: 'available_commands_update',
      },
    ]);
  });

  it('从 ACP initialize 生成供应商无关 capability', () => {
    const capabilities = mapAcpCapabilities(
      {
        loadSession: true,
        promptCapabilities: { image: true },
        mcpCapabilities: { http: true },
        sessionCapabilities: { resume: {}, close: {}, additionalDirectories: {} },
      },
      { files: true, terminal: false, models: true, modes: true },
      {
        modes: {
          currentModeId: 'plan',
          availableModes: [{ id: 'plan', name: 'Plan', description: '规划模式' }],
        },
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'fixture-model',
            options: [{ value: 'fixture-model', name: 'Fixture Model' }],
          },
        ],
      },
    );

    expect(capabilities).toMatchObject({
      sessions: { create: true, load: true, resume: true, close: true },
      prompts: { text: true, images: true, resources: true },
      workspace: { files: true, terminal: false, additionalRoots: true, mcpHttp: true },
      configuration: {
        models: true,
        modes: true,
        modelOptions: [{ id: 'fixture-model', label: 'Fixture Model' }],
        modeOptions: [{ id: 'plan', label: 'Plan', description: '规划模式' }],
      },
    });
    expect(JSON.stringify(capabilities)).not.toMatch(/ACP|Docker|OpenClaw/i);
  });
});

it('projects only standard public ACP text content and keeps raw diagnostics private', () => {
  const normalized = normalizeAcpSessionUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'public-text',
    title: 'Command',
    status: 'in_progress',
    rawInput: { token: 'private-input' },
    rawOutput: { message: 'private-output' },
    content: [
      { type: 'content', content: { type: 'text', text: 'Public failure\nDetails' } },
      { type: 'content', content: { type: 'image', data: 'private-image', mimeType: 'image/png' } },
      { type: 'diff', path: '/private/path', oldText: 'private-old', newText: 'private-new' },
    ],
  });
  expect(normalized[0]?.payload.output).toBe('Public failure\nDetails');
  expect(JSON.stringify(normalized)).not.toContain('private-');
});
it('bounds public tool text with an explicit truncation marker', () => {
  const normalized = normalizeAcpSessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'long',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'x'.repeat(70_000) } }],
  });
  expect(normalized[0]?.payload.output).toBe(`${'x'.repeat(65_536)}\n[AgentHub：工具输出已截断]`);
});

it('keeps bounded public text replacement semantics and ignores absent/raw-only updates', () => {
  const missing = normalizeAcpSessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'x',
    status: 'failed',
    rawOutput: { message: 'secret-only' },
  });
  expect(missing[0]?.payload).not.toHaveProperty('output');
  expect(JSON.stringify(missing)).not.toContain('secret-only');
  const blocks = Array.from({ length: 65 }, (_, index) => ({
    type: 'content' as const,
    content: { type: 'text' as const, text: String(index) },
  }));
  const output = normalizeAcpSessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'x',
    status: 'failed',
    content: blocks,
  })[0]?.payload.output;
  expect(output).toBe(
    `${Array.from({ length: 64 }, (_, index) => String(index)).join('\n')}\n[AgentHub：工具输出已截断]`,
  );
});
