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
    expect(source).toContain('/projects/preflight-path');
    expect(source).toContain('添加前检查');
    expect(source).toContain('InlineError');
    expect(source).toContain('labelAdapterKind(candidate.adapterKind)');
    expect(source).toContain('labelAgentCandidateReason(candidate.reasonCode)');
  });
});
