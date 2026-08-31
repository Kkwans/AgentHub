import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeGitProject, expect, type RealApp } from './fixtures.js';
import type { BrowserContext } from '@playwright/test';

type Identified = { id: string };

export async function apiData<T>(
  context: BrowserContext,
  method: 'get' | 'post',
  path: string,
  data?: unknown,
) {
  const response = await context.request[method](
    `/api/v1${path}`,
    data === undefined ? undefined : { data },
  );
  expect(response.ok(), `${method.toUpperCase()} ${path}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

export async function seedWorkspace(context: BrowserContext, app: RealApp) {
  await initializeGitProject(app.projectRoot);
  const target = await apiData<Identified>(context, 'post', '/execution-targets', {
    name: 'v1 baseline host',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  const project = await apiData<Identified>(context, 'post', '/projects', {
    name: 'v1 baseline project',
    targetId: target.id,
    rootPath: app.projectRoot,
    kind: 'TEST',
  });
  const agent = await apiData<Identified>(context, 'post', '/agents', {
    name: 'v1 baseline agent',
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: process.execPath,
    args: [resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/acp/fake-agent.mjs')],
  });
  const preflight = await apiData<{ status: string }>(
    context,
    'post',
    `/agents/${agent.id}/preflight`,
    { cwd: app.projectRoot },
  );
  expect(preflight.status).toBe('READY');
  const session = await apiData<Identified>(context, 'post', '/sessions', {
    projectId: project.id,
    agentId: agent.id,
    title: 'v1 baseline session',
    cwd: app.projectRoot,
  });
  return { target, project, agent, session };
}
