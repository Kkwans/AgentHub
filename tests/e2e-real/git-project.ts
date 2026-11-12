import { execFile as execFileCallback } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const gitEnv = {
  PATH: '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

export async function initializeGitProject(projectRoot: string): Promise<void> {
  const git = (args: string[]) =>
    execFile('/usr/bin/git', args, {
      shell: false,
      windowsHide: true,
      env: gitEnv,
    });
  await writeFile(join(projectRoot, 'README.md'), '# AgentHub real E2E\n', 'utf8');
  await git(['init', '--initial-branch', 'main', projectRoot]);
  // Identity belongs only to this disposable test repository. Command-local
  // -c flags on the initial commit do not configure later backend commits.
  await git(['-C', projectRoot, 'config', '--local', 'user.name', 'AgentHub E2E']);
  await git(['-C', projectRoot, 'config', '--local', 'user.email', 'agenthub-e2e@invalid.local']);
  await git(['-C', projectRoot, 'add', 'README.md']);
  await git(['-C', projectRoot, 'commit', '-m', 'test: 初始化真实浏览器项目']);
}
