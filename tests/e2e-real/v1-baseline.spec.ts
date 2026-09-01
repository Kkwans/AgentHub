import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { test, expect } from './fixtures.js';
import { apiData, seedWorkspace } from './baseline-support.js';
import type { Page } from '@playwright/test';

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

async function audit(page: Page) {
  return page.evaluate(measureLayout);
}

async function captureScreenshot(page: Page, path: string) {
  // Playwright's screenshot helper waits for all document fonts. On the
  // NAS aarch64 Chromium build that wait can take down the renderer at the
  // wide viewports; CDP captures the same surface without that extra phase.
  const client = await page.context().newCDPSession(page);
  try {
    const screenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  } finally {
    await client.detach();
  }
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
          await page.waitForTimeout(3_000);
          const filename = `${theme}-${route.replace(/^\//, '').replace(/[^a-zA-Z0-9-]+/g, '-') || 'home'}-${viewportName}.png`;
          await captureScreenshot(page, join(outputDir, filename));
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
