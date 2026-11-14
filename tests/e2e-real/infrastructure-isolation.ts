import { isAbsolute, join } from 'node:path';

/** Test-only environment. Never spread the runner environment into this object.
 * This limits the audited diagnostic lookup path, not OS-level filesystem access.
 */
export function infrastructureEnvironment(root: string, webDist: string): NodeJS.ProcessEnv {
  if (!isAbsolute(root) || !isAbsolute(webDist))
    throw new Error('Isolation paths must be absolute');
  return {
    PATH: join(root, 'empty-bin'),
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'local-data'),
    CODEX_HOME: join(root, 'codex'),
    TMPDIR: join(root, 'tmp'),
    AGENTHUB_HOST: '127.0.0.1',
    AGENTHUB_PORT: '0',
    AGENTHUB_WEB_DIST: webDist,
    AGENTHUB_DATA_DIR: join(root, 'database'),
    AGENTHUB_WORKTREE_ROOT: join(root, 'worktrees'),
    AGENTHUB_WORKSPACE_ROOTS_JSON: JSON.stringify([join(root, 'workspace')]),
    AGENTHUB_AUTH_MODE: 'local_trusted',
    AGENTHUB_SECURE_TRANSPORT: 'false',
    LOG_LEVEL: 'silent',
  };
}

/** A future dedicated child uses the absolute current Node binary, never PATH resolution.
 * Deliberately does not spawn: lifecycle/readiness/strict cleanup must be wired separately.
 */
export function infrastructureChildLaunch(root: string, webDist: string, entry: string) {
  if (!isAbsolute(entry)) throw new Error('Isolation entry must be absolute');
  return {
    executable: process.execPath,
    args: [entry],
    cwd: root,
    env: infrastructureEnvironment(root, webDist),
    shell: false as const,
  };
}
