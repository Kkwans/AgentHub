// Test-only process: no browser, Provider, registration or diagnostic command is started here.
import process from 'node:process';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const expectedKeys = [
  'PATH',
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'CODEX_HOME',
  'TMPDIR',
  'AGENTHUB_HOST',
  'AGENTHUB_PORT',
  'AGENTHUB_WEB_DIST',
  'AGENTHUB_DATA_DIR',
  'AGENTHUB_WORKTREE_ROOT',
  'AGENTHUB_WORKSPACE_ROOTS_JSON',
  'AGENTHUB_AUTH_MODE',
  'AGENTHUB_SECURE_TRANSPORT',
  'LOG_LEVEL',
];
let running;
let closing;
const send = (message) =>
  new Promise((done) => {
    if (!process.connected) return done();
    process.send(message, () => done());
  });
const close = () =>
  (closing ??= (async () => {
    try {
      if (running) await running.close();
      await send({ type: 'closed' });
      process.exit(0);
    } catch {
      await send({ type: 'failed', code: 'CHILD_CLOSE_FAILED' });
      process.exit(1);
    }
  })());

let closeRequested = false;
const requestClose = () => {
  closeRequested = true;
  if (running) void close();
};
process.on('message', (message) => {
  if (message?.type === 'close') requestClose();
});
process.on('disconnect', requestClose);

try {
  const root = await realpath(process.cwd());
  if (
    root !== process.cwd() ||
    Object.keys(process.env).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => typeof process.env[key] !== 'string')
  )
    throw new Error();
  const folders = {
    PATH: 'empty-bin',
    HOME: 'home',
    XDG_CONFIG_HOME: 'config',
    XDG_CACHE_HOME: 'cache',
    XDG_DATA_HOME: 'local-data',
    CODEX_HOME: 'codex',
    TMPDIR: 'tmp',
    AGENTHUB_DATA_DIR: 'database',
    AGENTHUB_WORKTREE_ROOT: 'worktrees',
  };
  for (const [key, name] of Object.entries(folders)) {
    const path = join(root, name);
    if (
      process.env[key] !== path ||
      !(await lstat(path)).isDirectory() ||
      (await lstat(path)).isSymbolicLink() ||
      (await realpath(path)) !== path
    )
      throw new Error();
  }
  const workspace = join(root, 'workspace');
  if (
    process.env.AGENTHUB_WORKSPACE_ROOTS_JSON !== JSON.stringify([workspace]) ||
    !(await lstat(workspace)).isDirectory() ||
    (await realpath(workspace)) !== workspace ||
    (await readdir(process.env.PATH)).length !== 0 ||
    process.env.AGENTHUB_HOST !== '127.0.0.1' ||
    process.env.AGENTHUB_PORT !== '0' ||
    process.env.AGENTHUB_AUTH_MODE !== 'local_trusted' ||
    process.env.AGENTHUB_SECURE_TRANSPORT !== 'false' ||
    process.env.LOG_LEVEL !== 'silent' ||
    resolve(process.env.AGENTHUB_WEB_DIST) !== process.env.AGENTHUB_WEB_DIST
  )
    throw new Error();
  // Validation precedes importing the actual server and all its dependencies.
  const { startServer } = await import('../../apps/server/dist/index.js');
  running = await startServer(process.env);
  const address = running.server.address();
  if (
    !address ||
    typeof address === 'string' ||
    address.address !== '127.0.0.1' ||
    address.port <= 0
  )
    throw new Error();
  if (closeRequested || !process.connected) await close();
  else
    await send({
      type: 'ready',
      origin: `http://127.0.0.1:${address.port}`,
      isolatedEnvironment: true,
      emptyPath: true,
    });
} catch {
  if (running) {
    try {
      await running.close();
    } catch {
      /* Parent retains the directory on any failed startup. */
    }
  }
  await send({ type: 'failed', code: 'CHILD_START_FAILED' });
  process.exit(1);
}
