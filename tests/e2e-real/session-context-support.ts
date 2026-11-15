import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { BrowserContext } from '@playwright/test';
import { apiData } from './baseline-support.js';
import { expect, initializeGitProject, type RealApp } from './fixtures.js';

const execFile = promisify(execFileCallback);
type Identified = { id: string };
export type SeededContextSession = Identified & {
  projectId: string;
  agentId: string;
  status: string;
  title: string;
  cwd: string;
  branch: string | null;
  model: string | null;
};
type ModelConfiguration = {
  supported: boolean;
  current: { model: string | null };
  options: { models: Array<{ id: string }> };
};
export const LONG_SESSION_CONTEXT = {
  title: '检查多 Agent 并行执行时的权限边界与工作目录隔离，验证中文路径和完整会话上下文的键盘阅读',
  agentName: '研发协作与安全审查 Engineering Review Agent · 多工作目录长上下文验收',
  model:
    'fixture-engineering-review-model-extended-context-multilingual-workspace-isolation-preview-2026-11',
  branch:
    'feature/会话上下文/engineering-review-agent-model-and-working-directory-isolation-validation',
  directoryLabel: 'client-web',
} as const;

/** Real disposable filesystem + HTTP/ACP setup, never a DB or response rewrite.
 * Call once in a fresh RealApp, just like seedWorkspace. No prompt/run is sent. */
export async function seedLongSessionContext(context: BrowserContext, app: RealApp) {
  expect(LONG_SESSION_CONTEXT.title.length).toBeLessThanOrEqual(240);
  expect(LONG_SESSION_CONTEXT.agentName.length).toBeLessThanOrEqual(120);
  expect(LONG_SESSION_CONTEXT.model.length).toBeLessThanOrEqual(160);
  expect(LONG_SESSION_CONTEXT.branch.length).toBeLessThanOrEqual(1024);
  await initializeGitProject(app.projectRoot);
  const git = (args: string[]) =>
    execFile('/usr/bin/git', ['-C', app.projectRoot, ...args], {
      shell: false,
      windowsHide: true,
      env: {
        PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  await git(['checkout', '-b', LONG_SESSION_CONTEXT.branch]);
  expect((await git(['branch', '--show-current'])).stdout.trim()).toBe(LONG_SESSION_CONTEXT.branch);
  const target = await apiData<Identified>(context, 'post', '/execution-targets', {
    name: '会话长上下文验收主机',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  const project = await apiData<Identified>(context, 'post', '/projects', {
    name: '会话长上下文真实验收项目',
    targetId: target.id,
    rootPath: app.projectRoot,
    kind: 'TEST',
  });
  const agent = await apiData<Identified>(context, 'post', '/agents', {
    name: LONG_SESSION_CONTEXT.agentName,
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: process.execPath,
    args: [
      resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/acp/fake-agent.mjs'),
      `--session-context-model=${LONG_SESSION_CONTEXT.model}`,
    ],
  });
  const createContext = async (subtree: string, title: string) => {
    expect(title.length).toBeLessThanOrEqual(240);
    const directory = join(
      app.projectRoot,
      subtree,
      '权限边界 与隔离验证',
      '多 Agent 长上下文',
      '前端应用 独立工作副本',
      LONG_SESSION_CONTEXT.directoryLabel,
    );
    await mkdir(directory, { recursive: true });
    const cwd = await realpath(directory);
    expect(cwd.length).toBeLessThanOrEqual(4096);
    const preflight = await apiData<{ status: string }>(
      context,
      'post',
      `/agents/${agent.id}/preflight`,
      { cwd },
    );
    expect(preflight.status).toBe('READY');
    const created = await apiData<Identified>(context, 'post', '/sessions', {
      projectId: project.id,
      agentId: agent.id,
      title,
      cwd,
      branch: LONG_SESSION_CONTEXT.branch,
      model: LONG_SESSION_CONTEXT.model,
    });
    const session = await apiData<SeededContextSession>(context, 'get', `/sessions/${created.id}`);
    const expected = { ...LONG_SESSION_CONTEXT, title, cwd };
    expect(session).toMatchObject({
      id: created.id,
      projectId: project.id,
      agentId: agent.id,
      status: 'READY',
      title: expected.title,
      cwd,
      branch: expected.branch,
      model: expected.model,
    });
    const configuration = await apiData<ModelConfiguration>(
      context,
      'get',
      `/sessions/${session.id}/configuration`,
    );
    expect(configuration.supported).toBe(true);
    expect(configuration.current.model).toBe(expected.model);
    expect(configuration.options.models.map((option) => option.id)).toEqual(
      expect.arrayContaining(['fixture-model', 'fixture-model-2', expected.model]),
    );
    return { session, expected };
  };
  const { session, expected } = await createContext(
    '研发协作 工作区甲',
    LONG_SESSION_CONTEXT.title,
  );
  const { session: peerSession, expected: peerExpected } = await createContext(
    '独立审查 工作区乙',
    '核对第二个独立工作目录的完整会话上下文，区分同名 client-web 与不同真实路径',
  );
  expect(peerSession.cwd).not.toBe(session.cwd);
  const savedAgents = await apiData<Array<{ id: string; name: string }>>(context, 'get', '/agents');
  const matches = savedAgents.filter((saved) => saved.id === agent.id);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.name).toBe(expected.agentName);
  return { target, project, agent, session, expected, peerSession, peerExpected };
}
