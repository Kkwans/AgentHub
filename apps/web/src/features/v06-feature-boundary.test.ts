import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('v0.6 feature boundaries', () => {
  it('removes the legacy ControlPages God Component', () => {
    expect(existsSync(new URL('../pages/ControlPages.tsx', import.meta.url))).toBe(false);
    for (const path of [
      './sessions/pages/SessionsPage.tsx',
      './tasks/pages/TasksPage.tsx',
      './settings/pages/SettingsPage.tsx',
    ]) {
      expect(source(path)).not.toContain('ControlPages');
    }
  });

  it('keeps write flows inside the shared Dialog/Form system', () => {
    expect(source('./sessions/pages/SessionsPageView.tsx')).toContain('<FormDialog');
    expect(source('./tasks/pages/TasksPageView.tsx')).toContain('<FormDialog');
    expect(source('./settings/pages/SettingsPageView.tsx')).toContain('<FormDialog');
    expect(source('./promptos/components/PromptOsSections.tsx')).toContain('<FormDialog');
  });

  it('keeps Workspace interaction panels outside the route shell', () => {
    const route = source('../pages/WorkspacePage.tsx');
    const sections = source('./workspace/components/WorkspaceSections.tsx');
    const terminal = source('./workspace/components/TerminalDock.tsx');
    expect(route).toContain("from '../features/workspace/components/WorkspaceSections'");
    expect(route).toContain("from '../features/workspace/components/TerminalDock'");
    expect(route).not.toContain('function Conversation(');
    expect(route).not.toContain('function Composer(');
    expect(sections).toContain('export function Conversation(');
    expect(sections).toContain('export function Composer(');
    expect(terminal).toContain("from '@xterm/xterm'");
    expect(terminal).toContain("'/terminals'");
  });

  it('keeps PromptOS ordinary-user labels in the feature section', () => {
    const promptos = source('./promptos/components/PromptOsSections.tsx');
    expect(promptos).toContain('labelPromptBindingTarget');
    expect(promptos).toContain('labelPromptBindingSlot');
    expect(promptos).toContain('通过任务名称选择');
    expect(promptos).not.toContain('<option>PROJECT</option>');
    expect(promptos).not.toContain('可选 UUID');
  });
});
