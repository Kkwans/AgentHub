import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { test as base, expect, type BrowserContext } from '@playwright/test';

import { startServer, type RunningServer } from '../../apps/server/dist/index.js';

const execFile = promisify(execFileCallback);
const tempRootPrefix = 'agenthub-pw-real-';

export type RealAuthMode = 'token' | 'local_trusted';

export type RealApp = {
  origin: string;
  projectRoot: string;
  worktreeRoot: string;
  dataRoot: string;
};

type TestFixtures = {
  app: RealApp;
  context: BrowserContext;
};

type WorkerFixtures = {
  authMode: RealAuthMode;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  authMode: ['token', { option: true }],

  app: async ({ authMode }, use) => {
    const configuredTempBase = process.env.AGENTHUB_E2E_REAL_TMPDIR;
    const tempBase = resolve(configuredTempBase || tmpdir());
    await mkdir(tempBase, { recursive: true });
    const tempRoot = await mkdtemp(join(tempBase, tempRootPrefix));
    const dataRoot = join(tempRoot, 'data');
    const worktreeRoot = join(tempRoot, 'worktrees');
    const projectRoot = join(tempRoot, 'project');

    let running: RunningServer | undefined;
    try {
      await Promise.all([mkdir(dataRoot), mkdir(worktreeRoot), mkdir(projectRoot)]);
      const environment: NodeJS.ProcessEnv = {
        AGENTHUB_HOST: '127.0.0.1',
        AGENTHUB_PORT: '0',
        AGENTHUB_WEB_DIST: resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web/dist'),
        AGENTHUB_DATA_DIR: dataRoot,
        AGENTHUB_WORKTREE_ROOT: worktreeRoot,
        AGENTHUB_AUTH_MODE: authMode,
        AGENTHUB_SECURE_TRANSPORT: 'false',
        LOG_LEVEL: 'silent',
      };

      running = await startServer(environment);
      const address = running.server.address();
      if (!address || typeof address === 'string' || address.port <= 0) {
        throw new Error('真实 E2E server 未监听 loopback 动态端口');
      }
      const host = address.address === '::' ? '[::1]' : address.address;
      if (host !== '127.0.0.1' && host !== '[::1]') {
        throw new Error(`真实 E2E server origin 非 loopback：${host}`);
      }

      const healthResponse = await fetch(`http://127.0.0.1:${String(address.port)}/api/v1/health`);
      if (!healthResponse.ok) throw new Error(`真实 E2E health 请求失败：${healthResponse.status}`);
      const health = (await healthResponse.json()) as {
        data?: { database?: string; web?: boolean };
      };
      if (health.data?.database !== 'pglite' || health.data.web !== true) {
        throw new Error('真实 E2E health 未确认 pglite 与 web dist');
      }

      await use({
        origin: `http://127.0.0.1:${String(address.port)}`,
        projectRoot,
        worktreeRoot,
        dataRoot,
      });
    } finally {
      if (running) await running.close();
      await removeTempRoot(tempRoot, tempBase);
    }
  },

  context: async ({ browser, app }, use) => {
    const context = await browser.newContext({ baseURL: app.origin });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});

export { expect };

export async function initializeGitProject(projectRoot: string): Promise<void> {
  await writeFile(join(projectRoot, 'README.md'), '# AgentHub real E2E\n', 'utf8');
  await execFile('/usr/bin/git', ['init', '--initial-branch', 'main', projectRoot], {
    shell: false,
    windowsHide: true,
    env: {
      PATH: '/usr/bin:/bin',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  await execFile('/usr/bin/git', ['-C', projectRoot, 'add', 'README.md'], {
    shell: false,
    windowsHide: true,
    env: {
      PATH: '/usr/bin:/bin',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  await execFile(
    '/usr/bin/git',
    [
      '-C',
      projectRoot,
      '-c',
      'user.name=AgentHub E2E',
      '-c',
      'user.email=agenthub-e2e@invalid.local',
      'commit',
      '-m',
      'test: 初始化真实浏览器项目',
    ],
    {
      shell: false,
      windowsHide: true,
      env: {
        PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  );
}

async function removeTempRoot(tempRoot: string, tempBase: string): Promise<void> {
  const canonicalBase = await realpath(tempBase);
  const canonicalRoot = await realpath(tempRoot);
  const relativeRoot = relative(canonicalBase, canonicalRoot);
  if (
    !canonicalRoot.startsWith(`${canonicalBase}/`) ||
    dirname(canonicalRoot) !== canonicalBase ||
    relativeRoot.startsWith('..') ||
    !canonicalRoot.split('/').at(-1)?.startsWith(tempRootPrefix)
  ) {
    throw new Error(`拒绝删除不符合约束的真实 E2E 临时目录：${canonicalRoot}`);
  }
  await rm(canonicalRoot, { recursive: true, force: false });
}

export async function assertPageUsesRealServer(page: { url(): string }, origin: string) {
  expect(page.url()).toContain(origin);
}
