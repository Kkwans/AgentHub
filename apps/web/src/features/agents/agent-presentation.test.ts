import { expect, it } from 'vitest';
import { agentKindLabel } from './agent-presentation';
it.each([
  ['CODEX', 'Codex'],
  ['CLAUDE_CODE', 'Claude Code'],
  ['OPENCODE', 'OpenCode'],
  ['HERMES', 'Hermes'],
  ['OPENCLAW', 'OpenClaw'],
  ['CUSTOM_ACP', '自定义 ACP'],
])('已接入类型%s显示真实名称%s', (kind, label) => {
  expect(agentKindLabel(kind)).toBe(label);
});
it.each(['GEMINI', 'unknown', '', '__proto__', 'toString'])(
  '未知类型%s不虚构接入或读取prototype标签',
  (kind) => {
    expect(agentKindLabel(kind)).toBe('Agent');
  },
);
