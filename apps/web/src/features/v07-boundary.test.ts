import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('v0.7 feature boundaries', () => {
  it('keeps feature pages behind @agenthub/ui and avoids native primary controls', () => {
    const pages = read('./v07/pages.tsx');
    expect(pages).not.toContain("from '@mantine/core'");
    expect(pages).not.toContain("from '@radix-ui/themes'");
    expect(pages).not.toMatch(/<select\b/);
    expect(pages).not.toContain('<option>');
  });

  it('does not add versioned global CSS patches to the v0.7 surface', () => {
    const pages = read('./v07/pages.tsx');
    expect(pages).not.toMatch(/(?:v07-[^'" ]+\.css|final-fix\.css|override\.css)/);
  });

  it('keeps ordinary Agent and Prompt copy translated through view models', () => {
    const pages = read('./v07/pages.tsx');
    expect(pages).toContain('agentKindLabel');
    expect(pages).toContain('labelPromptBindingTarget');
    expect(pages).toContain('labelPromptSelector');
    expect(pages).not.toContain('{agent.adapterKind}');
    expect(pages).not.toContain('>{candidate.candidateId}<');
  });

  it('keeps real Workspace capability composition separate from the route page', () => {
    const pages = read('./v07/pages.tsx');
    const sections = read('./workspace/components/WorkspaceSections.tsx');
    const terminal = read('./workspace/components/TerminalDock.tsx');
    expect(pages).toContain("from '../workspace/components/WorkspaceSections'");
    expect(pages).toContain("from '../workspace/components/TerminalDock'");
    expect(sections).toContain('export function Conversation(');
    expect(sections).toContain('export function Composer(');
    expect(terminal).toContain("'/terminals'");
  });
});
