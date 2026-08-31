import { execFile as execFileCallback } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { initializeGitProject, test, expect, type RealApp } from './fixtures.js';
import type { BrowserContext, Page } from '@playwright/test';

type Identified = { id: string };
type Health = { status: string; version: string; database: string; web: boolean };

const execFile = promisify(execFileCallback);
const loadEvidence = createRequire(import.meta.url);
const { measureLayout, writeAudit } = loadEvidence('../../scripts/qa/visual-evidence.cjs');
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const viewports = [
  ['1920x1080', { width: 1920, height: 1080 }],
  ['1600x1000', { width: 1600, height: 1000 }],
  ['1440x900', { width: 1440, height: 900 }],
  ['1280x800', { width: 1280, height: 800 }],
  ['1024x768', { width: 1024, height: 768 }],
  ['768x1024', { width: 768, height: 1024 }],
  ['390x844', { width: 390, height: 844 }],
] as const;
const themes = ['light', 'dark'] as const;
const selectedViewports = process.env.AGENTHUB_VISUAL_VIEWPORT
  ? viewports.filter(([name]) => name === process.env.AGENTHUB_VISUAL_VIEWPORT)
  : viewports;
const selectedThemes = process.env.AGENTHUB_VISUAL_THEME
  ? themes.filter((theme) => theme === process.env.AGENTHUB_VISUAL_THEME)
  : themes;
if (!selectedViewports.length || !selectedThemes.length)
  throw new Error('Unknown diagnostic viewport/theme');
const outputDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env.AGENTHUB_VISUAL_OUTPUT ||
    `../../docs/qa/visual/v1.0.0/00-baseline-isolated-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

async function apiData<T>(
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

async function seedWorkspace(context: BrowserContext, app: RealApp) {
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

async function audit(page: Page) {
  return page.evaluate(measureLayout);
}

test.describe('v1 current-main isolated visual baseline', () => {
  test.use({ authMode: 'local_trusted' });

  test('captures all core routes, themes and required viewports', async ({
    browser,
    context,
    app,
  }) => {
    test.setTimeout(1_200_000);
    const fixture = await seedWorkspace(context, app);
    const serverHealth = await apiData<Health>(context, 'get', '/health');
    const { stdout: sourceCommitOutput } = await execFile(
      '/usr/bin/git',
      ['-c', `safe.directory=${repositoryRoot}`, 'rev-parse', 'HEAD'],
      {
        cwd: repositoryRoot,
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
    const sourceCommit = sourceCommitOutput.trim();
    const fixtureId = `v1-baseline:${fixture.session.id}`;
    const routes = [
      '/home',
      '/projects',
      '/agents',
      '/prompts',
      '/settings/appearance',
      '/agents/runtime',
      `/projects/${fixture.project.id}/overview`,
      `/projects/${fixture.project.id}/work`,
      `/projects/${fixture.project.id}/sessions`,
      `/workspace/${fixture.session.id}`,
    ];
    const report: Record<string, unknown>[] = [];
    await mkdir(outputDir, { recursive: false });
    const evidence = {
      source: 'isolated-real-server',
      complete: false,
      activeSnapshot: '',
      failure: '',
      sourceCommit,
      baseURL: app.origin,
      serverHealth,
      fixture: { id: fixtureId, ...fixture },
      routes,
      viewports: viewports.map(([name]) => name),
      themes,
      pages: report,
      unverifiedStates: [
        'login',
        'loading',
        'error',
        'running',
        'approval',
        'failed',
        'closed',
        'git-changes',
        'terminal',
      ],
    };
    writeAudit(outputDir, evidence);

    for (const theme of selectedThemes) {
      for (const [viewportName, viewport] of selectedViewports) {
        const visualContext = await browser.newContext({ baseURL: app.origin, viewport });
        await visualContext.addInitScript(
          ({ selectedTheme, origin }) => {
            if (window.location.origin === origin)
              window.localStorage.setItem('agenthub-theme', selectedTheme);
          },
          { selectedTheme: theme, origin: app.origin },
        );
        for (const route of routes) {
          const page = await visualContext.newPage();
          evidence.activeSnapshot = `${theme}/${viewportName}/${route}`;
          writeAudit(outputDir, evidence);
          page.on('crash', () => {
            evidence.failure = `Renderer crashed at ${evidence.activeSnapshot}`;
            writeAudit(outputDir, evidence);
          });
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          const failedRequests: string[] = [];
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240));
          });
          page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 240)));
          page.on('requestfailed', (request) =>
            failedRequests.push(`${request.method()} ${request.url()}`),
          );
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('main, .workspace-shell').first()).toBeVisible({
            timeout: 30_000,
          });
          await page.waitForTimeout(500);
          const filename = `${theme}-${route.replace(/^\//, '').replace(/[^a-zA-Z0-9-]+/g, '-') || 'home'}-${viewportName}.png`;
          await page.screenshot({
            path: join(outputDir, filename),
            fullPage: false,
            timeout: 15_000,
          });
          report.push({
            theme,
            viewport: viewportName,
            route,
            filename,
            sourceCommit,
            serverHealth,
            fixtureId,
            consoleErrors: [...consoleErrors],
            pageErrors: [...pageErrors],
            failedRequests: [...failedRequests],
            layout: await audit(page),
          });
          writeAudit(outputDir, evidence);
          console.log(
            `baseline ${report.length}/${routes.length * themes.length * viewports.length}: ${theme} ${viewportName} ${route}`,
          );
          await page.close();
        }
        await visualContext.close();
      }
    }
    evidence.complete =
      selectedViewports.length === viewports.length && selectedThemes.length === themes.length;
    writeAudit(outputDir, evidence);
  });
});
