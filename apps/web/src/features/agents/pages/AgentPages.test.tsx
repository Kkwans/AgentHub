import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('Agent feature page contracts', () => {
  it('keeps ordinary Agent and infrastructure copy presentation-owned', () => {
    const pages = [
      read('AgentCenterPage.tsx'),
      read('DiscoverAgentsPage.tsx'),
      read('InfrastructurePage.tsx'),
      read('RemoteNodeRegistrationPage.tsx'),
      read('RemoteNodeDetailPage.tsx'),
    ].join('\n');
    expect(pages).toContain('agentKindLabel');
    expect(pages).not.toContain('labelAdapterKind(candidate.adapterKind)');
    expect(pages).not.toContain('candidate.candidateId.slice');
    expect(pages).not.toContain('下一阶段启用');
  });
});
