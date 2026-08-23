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

  it('keeps Task and Worktree review copy in Chinese', () => {
    const tasks = source('./tasks/pages/TasksPageView.tsx');
    const promptos = source('./promptos/components/PromptOsSections.tsx');
    expect(tasks).toContain('Task 审阅');
    expect(tasks).toContain('审阅证据');
    expect(tasks).toContain('基准分支');
    expect(tasks).toContain('任务分支');
    expect(tasks).not.toContain('Task Review');
    expect(tasks).not.toContain('Review evidence');
    expect(tasks).not.toContain('<span>base branch</span>');
    expect(tasks).not.toContain('<span>task branch</span>');
    expect(promptos).toContain('和优先级查看最终内容');
    expect(promptos).not.toContain('和 priority 查看最终内容');
  });

  it('gives mobile Task boards a clear horizontal navigation hint', () => {
    const tasks = source('./tasks/pages/TasksPageView.tsx');
    expect(tasks).toContain('手机端左右滑动查看其他状态');
    expect(tasks).toContain('aria-describedby="task-board-hint"');
    expect(existsSync(new URL('../styles/v3-controls.css', import.meta.url))).toBe(false);
  });

  it('keeps Remote Node capability limits actionable and version-neutral', () => {
    const api = source('../lib/api.ts');
    const sessionService = source('../../../server/src/sessions/session-service.ts');
    const worktreeService = source('../../../server/src/worktrees/worktree-task-service.ts');
    const gitService = source('../../../server/src/git/git-service.ts');
    for (const copy of [api, sessionService, worktreeService, gitService]) {
      expect(copy).not.toContain('下一阶段启用');
      expect(copy).not.toContain('v0.2 暂不提供');
    }
    expect(api).toContain('请改用普通 Session');
    expect(api).toContain('当前 Remote Node 不支持 Git 控制');
  });

  it('keeps Terminal capability codes out of ordinary-user UI', () => {
    const terminal = source('./workspace/components/TerminalDock.tsx');
    const settings = source('./settings/pages/SettingsPageView.tsx');
    expect(terminal).not.toContain('{capability?.code}');
    expect(settings).not.toContain('terminal.code');
  });

  it('keeps adapter implementation details out of ordinary Agent surfaces', () => {
    const discovery = source('../pages/v06/DiscoveryPages.tsx');
    const remoteNodes = source('../pages/RemoteNodesPanel.tsx');
    expect(discovery).not.toContain('labelAdapterKind(candidate.adapterKind)');
    expect(remoteNodes).not.toContain('labelAdapterKind(agent.adapterKind)');
  });

  it('keeps warning surfaces symmetric instead of using a one-sided accent bar', () => {
    const uiStyles = readFileSync(
      new URL('../../../../packages/ui/src/styles.css', import.meta.url),
      'utf8',
    );
    expect(uiStyles).toContain('--ah-border-default');
    expect(uiStyles).toContain('--ah-danger-soft');
    expect(uiStyles).not.toMatch(/\.rt-|var\(--gray-|var\(--accent-/);
    for (const path of ['../styles.css', '../styles/design-system.css', '../styles/v3-controls.css']) {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    }
  });

  it('keeps internal object ids out of ordinary workspace and dashboard copy', () => {
    const overview = source('../pages/OverviewPage.tsx');
    const workspace = source('./workspace/components/WorkspaceSections.tsx');
    expect(overview).not.toContain('approval.sessionId.slice(0, 8)');
    expect(overview).not.toContain('run.id.slice(0, 8)');
    expect(workspace).not.toContain('activeRun.id.slice(0, 8)');
    expect(workspace).not.toContain('session.agentId.slice(0, 8)');
    expect(workspace).not.toContain('run.id.slice(0, 8)');
  });

  it('keeps the dashboard Project repository label in presentation copy', () => {
    const overview = source('../pages/OverviewPage.tsx');
    expect(overview).not.toContain('<span>{project.repoKind}</span>');
    expect(overview).toContain("project.repoKind === 'GIT' ? 'Git' : '非 Git'");
  });
});
