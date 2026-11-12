import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

import { initializeGitProject } from '../e2e-real/git-project.js';

const execFile = promisify(execFileCallback);

it('persists test-repository identity for later server-style commits without global config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-git-fixture-'));
  const git = (args: string[]) =>
    execFile('/usr/bin/git', ['-C', root, ...args], {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: root,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  try {
    await initializeGitProject(root);
    await writeFile(join(root, 'fixture-output.md'), '# fixture output\n');
    await git(['add', '-N', '--', 'fixture-output.md']);
    await git(['add', '--', 'fixture-output.md']);
    await git(['commit', '--only', '-m', 'test: Workspace ACP 输出', '--', 'fixture-output.md']);
    const commit = await git(['show', '--format=%an <%ae>%n%s', '--name-only', 'HEAD']);
    expect(commit.stdout).toContain('AgentHub E2E <agenthub-e2e@invalid.local>');
    expect(commit.stdout).toContain('test: Workspace ACP 输出');
    expect(commit.stdout).toContain('fixture-output.md');
    expect((await git(['status', '--porcelain'])).stdout.trim()).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
