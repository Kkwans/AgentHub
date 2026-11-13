import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from '@agenthub/agent-core';
import { expect, it } from 'vitest';
import { isolateGitEnvironment } from './git-write-resource.js';
it('过滤ambient Git重定向但保留正常HOME/身份与credential transport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-git-env-'));
  try {
    await writeFile(
      join(root, '.gitconfig'),
      '[user]\n name = Global Only\n email = global@example.invalid\n',
    );
    const env = isolateGitEnvironment({
      PATH: '/usr/bin:/bin',
      HOME: root,
      SSH_AUTH_SOCK: '/test/agent.sock',
      GIT_DIR: '/missing/attacker.git',
      GIT_WORK_TREE: '/missing',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.worktree',
      GIT_CONFIG_VALUE_0: '/missing',
      GIT_AUTHOR_NAME: 'injected',
    });
    expect(env).toMatchObject({
      HOME: root,
      SSH_AUTH_SOCK: '/test/agent.sock',
      GIT_TERMINAL_PROMPT: '0',
    });
    expect(Object.keys(env).filter((key) => key.startsWith('GIT_'))).toEqual([
      'GIT_TERMINAL_PROMPT',
    ]);
    const git = async (args: string[]) => {
      const result = await runProcess({
        executable: '/usr/bin/git',
        args: ['-C', root, ...args],
        inheritEnv: false,
        env,
        timeoutMs: 10000,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    await git(['init']);
    expect(await git(['rev-parse', '--show-toplevel'])).toBe(root);
    await writeFile(join(root, 'a.txt'), 'a');
    await git(['add', 'a.txt']);
    await git(['commit', '-m', 'global identity']);
    expect(await git(['log', '-1', '--format=%an <%ae>'])).toBe(
      'Global Only <global@example.invalid>',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
