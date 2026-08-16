import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('v0.6 ordinary-user flow contracts', () => {
  it('does not expose manual runtime or project path fields in the discovery page', () => {
    const source = readFileSync(new URL('./DiscoveryPages.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('name="rootPath"');
    expect(source).not.toContain('expectedContainerId');
    expect(source).not.toContain('name="executable"');
    expect(source).toContain('目录选择器');
    expect(source).toContain('接入并检查');
    expect(source).toContain('编辑项目');
    expect(source).toContain('归档项目');
    expect(source).toContain("'/projects/preflight'");
    expect(source).toContain('targetId,');
    expect(source).toContain('添加前检查');
    expect(source).toContain('InlineError');
    expect(source).toContain('目录范围读取失败');
    expect(source).toContain('目录内容读取失败');
    expect(source).toContain('工程扫描失败');
    expect(source).toContain('重新读取当前目录');
    expect(source).not.toContain('labelAdapterKind(candidate.adapterKind)');
    expect(source).toContain('labelAgentCandidateReason(candidate.reasonCode)');
    expect(source).toContain("filter((candidate) => candidate.agentKind !== 'UNKNOWN')");
    expect(source).toContain('请先完成该 Agent 的登录授权。');
    expect(source).toContain("source === 'REMOTE_NODE'");
    expect(source).toContain('<RuntimeDiscoveryPanel />');
  });
});
