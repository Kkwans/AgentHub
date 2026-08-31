import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { test, expect } from './fixtures.js';
import { apiData, seedWorkspace } from './baseline-support.js';
import type { Page } from '@playwright/test';

const { measureLayout, writeAudit } = createRequire(import.meta.url)(
  '../../scripts/qa/visual-evidence.cjs',
);
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 1000 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];
const themes = ['light', 'dark'] as const;

test.describe('v1 isolated entry and exception state baseline', () => {
  test.describe.configure({ timeout: 1_200_000 });
  test.use({ authMode: 'token' });

  test('captures login, loading, error and offline states on the real server', async ({
    browser,
    context,
    app,
  }) => {
    const outputDir = resolve(
      process.env.AGENTHUB_VISUAL_OUTPUT ||
        `docs/qa/visual/v1.0.0/00-exception-states-${Date.now()}`,
    );
    await mkdir(outputDir, { recursive: false });
    const accountPage = await context.newPage();
    await accountPage.goto('/');
    await expect(accountPage.getByRole('heading', { name: '创建管理员账号' })).toBeVisible();
    await accountPage.getByLabel('用户名').fill('exception-baseline');
    await accountPage.getByLabel('密码', { exact: true }).fill('exception-pass-123');
    await accountPage.getByLabel('确认密码').fill('exception-pass-123');
    await accountPage.getByRole('button', { name: '创建账号并进入' }).click();
    await expect(accountPage).toHaveURL(/\/home$/);
    await accountPage.close();

    const authenticatedStorageState = await context.storageState();
    const fixture = await seedWorkspace(context, app);
    const health = await apiData(context, 'get', '/health');
    const exceptionRoutes = [
      '/overview',
      `/workspace/${fixture.session.id}?state=loading`,
      '/workspace/00000000-0000-4000-8000-000000000000?state=error',
      `/workspace/${fixture.session.id}?state=offline`,
    ];
    const report: Record<string, unknown> = {
      source: 'isolated-real-server',
      complete: false,
      routes: exceptionRoutes,
      themes,
      viewports: viewports.map((v) => `${v.width}x${v.height}`),
      pages: [],
      serverHealth: health,
      fixtureId: `exception-states:${fixture.session.id}`,
      fixtureAgent: 'isolated ACP fixture; no production Agent or credential',
      unverifiedStates: ['PTY lifecycle', 'approval delivery after reconnect'],
      expectedNetworkFailures: {
        error: 'The invalid session route intentionally returns HTTP 404.',
        offline: 'The context is intentionally taken offline after the workspace shell loads.',
      },
      activeSnapshot: '',
      failure: '',
    };
    writeAudit(outputDir, report);

    const capture = async (
      state: string,
      url: string,
      theme: (typeof themes)[number],
      viewport: { width: number; height: number },
      storageState: typeof authenticatedStorageState | undefined,
      prepare?: (page: Page) => Promise<void>,
    ) => {
      const visualContext = await browser.newContext({
        baseURL: app.origin,
        viewport,
        storageState,
      });
      await visualContext.addInitScript(
        ({ origin, theme: selectedTheme }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', selectedTheme);
        },
        { origin: app.origin, theme },
      );
      const page = await visualContext.newPage();
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
      report.activeSnapshot = `${theme}/${viewport.width}x${viewport.height}/${state}`;
      writeAudit(outputDir, report);
      await prepare?.(page);
      const screenshotPath = join(
        outputDir,
        `${theme}-${state}-${viewport.width}x${viewport.height}.png`,
      );
      if (state === 'loading') {
        const client = await page.context().newCDPSession(page);
        const screenshot = await client.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        });
        await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
        await client.detach();
      } else {
        await page.screenshot({
          path: screenshotPath,
          fullPage: false,
          timeout: 30_000,
        });
      }
      (report.pages as Record<string, unknown>[]).push({
        theme,
        viewport: `${viewport.width}x${viewport.height}`,
        route: url,
        state,
        filename: `${theme}-${state}-${viewport.width}x${viewport.height}.png`,
        consoleErrors: consoleErrors.filter((message) => !isExpectedConsoleError(state, message)),
        pageErrors,
        failedRequests: failedRequests.filter(() => !isExpectedFailedRequest(state)),
        expectedConsoleErrors: consoleErrors.filter((message) =>
          isExpectedConsoleError(state, message),
        ),
        expectedFailedRequests: failedRequests.filter(() => isExpectedFailedRequest(state)),
        themePending: state === 'loading',
        layout: await page.evaluate(measureLayout),
      });
      writeAudit(outputDir, report);
      await page.close();
      await visualContext.close();
    };

    for (const theme of themes) {
      for (const viewport of viewports) {
        await capture('login', '/overview', theme, viewport, undefined, async (page) => {
          await page.goto('/overview', { waitUntil: 'domcontentloaded' });
          await expect(page.getByRole('heading', { name: '登录 AgentHub' })).toBeVisible();
        });
        await capture(
          'error',
          exceptionRoutes[2],
          theme,
          viewport,
          authenticatedStorageState,
          async (page) => {
            await page.goto(exceptionRoutes[2], {
              waitUntil: 'domcontentloaded',
            });
            await expect(page.getByRole('alert')).toContainText('暂时无法加载', {
              timeout: 30_000,
            });
          },
        );
        await capture(
          'offline',
          exceptionRoutes[3],
          theme,
          viewport,
          authenticatedStorageState,
          async (page) => {
            await page.goto(exceptionRoutes[3], {
              waitUntil: 'domcontentloaded',
            });
            await expect(page.locator('.workspace-shell')).toBeVisible({ timeout: 30_000 });
            await visualContextOffline(page);
          },
        );
        await capture(
          'loading',
          exceptionRoutes[1],
          theme,
          viewport,
          authenticatedStorageState,
          async (page) => {
            const client = await page.context().newCDPSession(page);
            await client.send('Network.enable');
            await client.send('Network.emulateNetworkConditions', {
              offline: false,
              latency: 1_000,
              downloadThroughput: 25_000,
              uploadThroughput: 25_000,
            });
            await page.goto(exceptionRoutes[1], {
              waitUntil: 'commit',
              timeout: 30_000,
            });
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
          },
        );
      }
    }
    report.complete = (report.pages as unknown[]).length === 4 * themes.length * viewports.length;
    writeAudit(outputDir, report);
  });
});

async function visualContextOffline(page: Page) {
  await page.context().setOffline(true);
  await page.waitForTimeout(500);
}

function isExpectedConsoleError(state: string, message: string): boolean {
  if (state === 'error') return message.includes('404 (Not Found)');
  if (state === 'offline') return message.includes('net::ERR_INTERNET_DISCONNECTED');
  return false;
}

function isExpectedFailedRequest(state: string): boolean {
  return state === 'offline';
}
