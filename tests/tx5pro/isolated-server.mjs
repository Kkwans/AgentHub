import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../apps/server/dist/index.js';

const execFile = promisify(execFileCallback);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const temporaryBase = resolve(process.env.AGENTHUB_TX5_TMP_BASE || '/dev/shm/agenthub-test-tmp');
const temporaryPrefix = 'agenthub-tx5-v05-';
const temporaryRoot = await createTemporaryRoot();
const projectRoot = join(temporaryRoot, 'project');
const dataRoot = join(temporaryRoot, 'data');
const worktreeRoot = join(temporaryRoot, 'worktrees');
const port = Number(process.env.AGENTHUB_TX5_PORT || '3220');
let running;
let closing = false;

try {
  await Promise.all([mkdir(projectRoot), mkdir(dataRoot), mkdir(worktreeRoot)]);
  await initializeGitProject(projectRoot);
  running = await startServer({
    ...process.env,
    AGENTHUB_HOST: '127.0.0.1',
    AGENTHUB_PORT: String(port),
    AGENTHUB_WEB_DIST: resolve(repositoryRoot, 'apps/web/dist'),
    AGENTHUB_DATA_DIR: dataRoot,
    AGENTHUB_WORKTREE_ROOT: worktreeRoot,
    AGENTHUB_AUTH_MODE: 'token',
    AGENTHUB_SECURE_TRANSPORT: 'false',
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
  });

  const ready = {
    origin: `http://127.0.0.1:${port}`,
    projectRoot,
    dataRoot,
    worktreeRoot,
    fixtureAgentPath: resolve(repositoryRoot, 'tests/fixtures/acp/fake-agent.mjs'),
    nodePath: process.execPath,
  };
  process.stdout.write(`AGENTHUB_TX5_READY ${JSON.stringify(ready)}\n`);

  process.once('SIGINT', () => void close('SIGINT'));
  process.once('SIGTERM', () => void close('SIGTERM'));
  await new Promise(() => undefined);
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  await close('startup-error', 1);
}

async function createTemporaryRoot() {
  await mkdir(temporaryBase, { recursive: true });
  return mkdtemp(join(temporaryBase, temporaryPrefix));
}

async function initializeGitProject(root) {
  await writeFile(join(root, 'README.md'), '# AgentHub TX5Pro v0.5 acceptance\n', 'utf8');
  const environment = {
    PATH: '/usr/bin:/bin',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
  await execFile('/usr/bin/git', ['init', '--initial-branch', 'main', root], {
    shell: false,
    windowsHide: true,
    env: environment,
  });
  await execFile('/usr/bin/git', ['-C', root, 'add', 'README.md'], {
    shell: false,
    windowsHide: true,
    env: environment,
  });
  await execFile(
    '/usr/bin/git',
    [
      '-C',
      root,
      '-c',
      'user.name=AgentHub TX5 QA',
      '-c',
      'user.email=agenthub-tx5@invalid.local',
      'commit',
      '-m',
      'test: 初始化 TX5Pro 验收项目',
    ],
    { shell: false, windowsHide: true, env: environment },
  );
}

async function close(reason, exitCode = 0) {
  if (closing) return;
  closing = true;
  try {
    if (running) await running.close();
    await removeTemporaryRoot();
  } catch (error) {
    process.stderr.write(`TX5Pro 隔离实例回收失败：${formatError(error)}\n`);
    exitCode = 1;
  } finally {
    process.stdout.write(`AGENTHUB_TX5_STOPPED ${reason}\n`);
    process.exit(exitCode);
  }
}

async function removeTemporaryRoot() {
  const canonicalBase = await realpath(temporaryBase);
  const canonicalRoot = await realpath(temporaryRoot);
  const relativeRoot = relative(canonicalBase, canonicalRoot);
  if (
    dirname(canonicalRoot) !== canonicalBase ||
    relativeRoot.startsWith('..') ||
    !canonicalRoot.split('/').at(-1)?.startsWith(temporaryPrefix)
  ) {
    throw new Error(`拒绝回收不符合约束的 TX5Pro 临时目录：${canonicalRoot}`);
  }
  await rm(canonicalRoot, { recursive: true, force: false });
}

function formatError(error) {
  return error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack || ''}`
    : String(error);
}
