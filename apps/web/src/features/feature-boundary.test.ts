import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('feature boundaries', () => {
  it('removes the legacy ControlPages God Component', () => {
    expect(existsSync(new URL('../pages/ControlPages.tsx', import.meta.url))).toBe(false);
    expect(existsSync(new URL('./sessions/pages/SessionsPage.tsx', import.meta.url))).toBe(false);
    expect(existsSync(new URL('./tasks/pages/TasksPage.tsx', import.meta.url))).toBe(false);
    expect(source('./settings/pages/SettingsPage.tsx')).not.toContain('ControlPages');
  });

  it('keeps write flows inside the shared Dialog/Form system', () => {
    expect(source('./projects/pages/ProjectSessionsPage.tsx')).toContain('<AhDialog');
    expect(source('./projects/pages/NewWorkPage.tsx')).toContain('<AhDialog');
    expect(source('./settings/pages/SettingsPageView.tsx')).toContain('<FormDialog');
    expect(source('./promptos/components/PromptDialogs.tsx')).toContain('<AhDialog');
  });

  it('keeps Workspace interaction panels outside the route shell', () => {
    const route = source('./workspace/pages/WorkspacePage.tsx');
    const view = source('./workspace/pages/WorkspaceView.tsx');
    const model = source('./workspace/useWorkspaceViewModel.ts');
    const sections = source('./workspace/components/WorkspaceInspector.tsx');
    const terminal = source('./workspace/components/TerminalDock.tsx');
    expect(view).toContain("from '../components/Conversation'");
    expect(view).toContain("from '../components/TerminalDock'");
    expect(route).not.toContain('function Conversation(');
    expect(route).not.toContain('function Composer(');
    expect(model).toContain("'/terminals'");
    expect(sections).toContain('export function WorkspaceInspector(');
    expect(terminal).toContain("from '@xterm/xterm'");
  });

  it('keeps PromptOS ordinary-user labels in the feature section', () => {
    const promptos = [
      './promptos/components/PromptDialogs.tsx',
      './promptos/components/PromptLifecycleDrawer.tsx',
      './promptos/components/PromptEditor.tsx',
    ]
      .map(source)
      .join('\n');
    expect(promptos).toContain('labelPromptBindingTarget');
    expect(promptos).toContain('labelPromptVersionSource');
    expect(promptos).toContain('新建 Prompt 绑定');
    expect(promptos).not.toContain('<option>PROJECT</option>');
    expect(promptos).not.toContain('可选 UUID');
  });

  it('keeps Task and Worktree review copy in Chinese', () => {
    const tasks = source('./projects/pages/ProjectWorkPage.tsx');
    const promptos = source('./promptos/components/PromptEditor.tsx');
    expect(tasks).toContain('待审阅');
    expect(tasks).toContain('验收标准');
    expect(tasks).toContain('执行信息');
    expect(tasks).toContain('分支：');
    expect(tasks).not.toContain('Task Review');
    expect(tasks).not.toContain('Review evidence');
    expect(tasks).not.toContain('<span>base branch</span>');
    expect(tasks).not.toContain('<span>task branch</span>');
    expect(promptos).toContain('Prompt 内容');
    expect(promptos).not.toContain('和 priority 查看最终内容');
  });

  it('gives mobile Task boards a clear horizontal navigation hint', () => {
    const tasks = source('./projects/pages/ProjectWorkPage.tsx');
    expect(tasks).toContain('手机端左右滑动查看其他状态');
    expect(tasks).toContain('aria-describedby="work-board-hint"');
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
    const discovery = source('./agents/pages/AgentCenterPage.tsx');
    const remoteNodes = source('./agents/components/RemoteNodesPanel.tsx');
    expect(discovery).not.toContain('labelAdapterKind(candidate.adapterKind)');
    expect(remoteNodes).not.toContain('labelAdapterKind(agent.adapterKind)');
  });

  it('keeps warning surfaces symmetric instead of using a one-sided accent bar', () => {
    const uiStyles = readFileSync(
      new URL('../../../../packages/ui/src/styles.css', import.meta.url),
      'utf8',
    );
    const uiTokens = readFileSync(
      new URL('../../../../packages/ui/src/tokens.css', import.meta.url),
      'utf8',
    );
    expect(uiStyles).toContain('--ah-border-default');
    expect(uiTokens).toContain('--ah-danger-soft');
    expect(uiStyles).not.toMatch(/\.rt-|var\(--gray-|var\(--accent-/);
    for (const path of [
      '../styles.css',
      '../styles/design-system.css',
      '../styles/v3-controls.css',
    ]) {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    }
  });

  it('keeps internal object ids out of ordinary workspace and dashboard copy', () => {
    const home = source('./home/pages/HomePage.tsx');
    const workspace = source('./workspace/components/Conversation.tsx');
    expect(home).not.toContain('approval.sessionId.slice(0, 8)');
    expect(home).not.toContain('run.id.slice(0, 8)');
    expect(workspace).not.toContain('activeRun.id.slice(0, 8)');
    expect(workspace).not.toContain('session.agentId.slice(0, 8)');
    expect(workspace).not.toContain('run.id.slice(0, 8)');
  });

  it('keeps the dashboard Project repository label in presentation copy', () => {
    const home = source('./home/pages/HomePage.tsx');
    expect(home).not.toContain('<span>{project.repoKind}</span>');
    expect(home).toContain("project.repoKind === 'GIT' ? 'Git 项目' : '目录项目'");
  });
});
