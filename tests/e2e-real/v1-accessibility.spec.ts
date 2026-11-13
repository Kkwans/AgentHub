import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.js';
import { summarizeAccessibility } from './accessibility-report.js';
import { apiData, seedWorkspace } from './baseline-support.js';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputPath = resolve(
  process.env.AGENTHUB_ACCESSIBILITY_OUTPUT || 'real-test-results/v1-accessibility.json',
);

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

type AxeNode = {
  target: Awaited<
    ReturnType<AxeBuilder['analyze']>
  >['violations'][number]['nodes'][number]['target'];
  html: string;
  failureSummary?: string;
};

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
};

type AccessibilityPage = {
  theme: (typeof themes)[number];
  viewport: string;
  route: string;
  violations: AxeViolation[];
  incomplete: number;
};

type AccessibilityReport = {
  source: 'isolated-real-server';
  complete: boolean;
  passed: boolean;
  phase: string;
  failedPhase: string | null;
  current: { theme: string; viewport: string; route: string } | null;
  pageFailures: Array<{
    theme: string;
    viewport: string;
    route: string;
    url: string;
    error: string;
    screenshot?: string;
  }>;
  missing: string[];
  failure: string;
  sourceCommit: string;
  baseURL: string;
  fixtureId: string;
  routes: string[];
  viewports: string[];
  themes: string[];
  pages: AccessibilityPage[];
  violations: Array<AxeViolation & Pick<AccessibilityPage, 'theme' | 'viewport' | 'route'>>;
  unverified: string[];
};

test.describe('v1 isolated real accessibility gate', () => {
  test.describe.configure({ timeout: 1_800_000 });
  test.use({ authMode: 'local_trusted' });

  test('has zero serious or critical axe violations across core routes', async ({
    browser,
    context,
    app,
  }) => {
    const report: AccessibilityReport = {
      source: 'isolated-real-server',
      complete: false,
      passed: false,
      phase: 'initializing',
      failedPhase: null,
      current: null,
      failure: '',
      sourceCommit: '',
      baseURL: app.origin,
      fixtureId: '',
      routes: [
        '/home',
        '/projects',
        '/agents',
        '/prompts',
        '/settings/appearance',
        '/agents/runtime',
        '/projects/:project/overview',
        '/projects/:project/work',
        '/projects/:project/work?task=:task',
        '/projects/:project/sessions',
        '/workspace/:session',
      ],
      viewports: viewports.map(([name]) => name),
      themes: [...themes],
      pages: [],
      violations: [],
      pageFailures: [],
      missing: [],
      unverified: [
        'interactive dialogs and expanded menus',
        'authenticated token mode and access errors',
        'review pending/unknown/error states',
        'keyboard-only full Workspace path',
        'focus return after drawer/dialog',
        'PTY lifecycle and terminal input',
        '200% zoom interaction coverage',
        'axe incomplete results require manual review; this gate covers serious/critical violations only',
      ],
    };
    report.missing = themes.flatMap((theme) =>
      viewports.flatMap(([name]) => report.routes.map((route) => `${theme}|${name}|${route}`)),
    );
    await mkdir(dirname(outputPath), { recursive: true });
    const writeReport = async () => {
      await writeFile(
        `${outputPath}.tmp`,
        `${JSON.stringify(report, null, 2)}
`,
        'utf8',
      );
      await rename(`${outputPath}.tmp`, outputPath);
    };
    await writeReport();
    try {
      report.phase = 'source-commit';
      await writeReport();
      const { stdout } = await execFile(
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
      const sourceCommit = stdout.trim();
      report.sourceCommit = sourceCommit;
      await writeReport();
      expect(sourceCommit).toMatch(/^[a-f0-9]{40}$/);
      if (process.env.GITHUB_SHA) expect(sourceCommit).toBe(process.env.GITHUB_SHA);
      report.phase = 'seed';
      await writeReport();
      const fixture = await seedWorkspace(context, app);
      // Baseline seeds TEST projects, hidden in collapsed directories and excluded
      // from Home's daily overview. Promote only this isolated fixture via the real API.
      const promote = await context.request.patch(`/api/v1/projects/${fixture.project.id}`, {
        data: { kind: 'STANDARD' },
      });
      expect(promote.ok(), await promote.text()).toBe(true);
      expect((await promote.json()).data.kind).toBe('STANDARD');
      const detailTask = await apiData<{ id: string }>(context, 'post', '/tasks', {
        projectId: fixture.project.id,
        title: '真实工作详情无障碍检查',
        description: '覆盖手机单详情中的执行配置与操作区域',
        acceptanceCriteria: '详情中的可交互元素通过 axe 严重级检查',
      });
      const detailRoute = `/projects/${fixture.project.id}/work?task=${detailTask.id}`;
      const routes = [
        '/home',
        '/projects',
        '/agents',
        '/prompts',
        '/settings/appearance',
        '/agents/runtime',
        `/projects/${fixture.project.id}/overview`,
        `/projects/${fixture.project.id}/work`,
        detailRoute,
        `/projects/${fixture.project.id}/sessions`,
        `/workspace/${fixture.session.id}`,
      ];
      report.sourceCommit = sourceCommit;
      report.fixtureId = `v1-accessibility:${fixture.session.id}`;
      report.routes = routes;
      report.phase = 'scanning';
      report.missing = themes.flatMap((theme) =>
        viewports.flatMap(([name]) => routes.map((route) => `${theme}|${name}|${route}`)),
      );
      await writeReport();
      for (const theme of themes) {
        for (const [viewportName, viewport] of viewports) {
          const visualContext = await browser.newContext({ baseURL: app.origin, viewport });
          await visualContext.addInitScript(
            ({ origin, selectedTheme }) => {
              if (window.location.origin === origin)
                window.localStorage.setItem('agenthub-theme', selectedTheme);
            },
            { origin: app.origin, selectedTheme: theme },
          );
          try {
            for (const route of routes) {
              report.current = { theme, viewport: viewportName, route };
              await writeReport();
              const page = await visualContext.newPage();
              try {
                const failedRequests: string[] = [];
                page.on('response', (response) => {
                  if (
                    response.url().startsWith(`${app.origin}/api/v1/`) &&
                    response.status() >= 400
                  )
                    failedRequests.push(`${response.status()} ${response.url()}`);
                });
                await page.emulateMedia({ reducedMotion: 'reduce' });
                await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                await waitForBusinessContent(page, route, detailRoute, fixture);
                expect(failedRequests, 'ready routes must not mask API failures').toEqual([]);
                const result = await new AxeBuilder({ page })
                  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                  .analyze();
                const violations = result.violations
                  .filter(
                    (violation) =>
                      violation.impact === 'serious' || violation.impact === 'critical',
                  )
                  .map((violation) => ({
                    id: violation.id,
                    impact: violation.impact ?? null,
                    help: violation.help,
                    helpUrl: violation.helpUrl,
                    nodes: violation.nodes.map((node) => ({
                      target: node.target,
                      html: node.html,
                      failureSummary: node.failureSummary,
                    })),
                  }));
                const pageResult: AccessibilityPage = {
                  theme,
                  viewport: viewportName,
                  route,
                  violations,
                  incomplete: result.incomplete.length,
                };
                report.pages.push(pageResult);
                report.missing = report.missing.filter(
                  (key) => key !== `${theme}|${viewportName}|${route}`,
                );
                for (const violation of violations) {
                  report.violations.push({ ...violation, theme, viewport: viewportName, route });
                }
                await writeReport();
                expect(failedRequests, 'API failures during axe scan').toEqual([]);
                if (violations.length) {
                  await page.screenshot({
                    path: resolve(
                      dirname(outputPath),
                      `violations-${theme}-${viewportName}-${routes.indexOf(route)}.png`,
                    ),
                    fullPage: true,
                    animations: 'disabled',
                    timeout: 5_000,
                  });
                }
                console.log(
                  `accessibility ${report.pages.length}/${routes.length * themes.length * viewports.length}: ${theme} ${viewportName} ${route}`,
                );
              } catch (error) {
                const entry: AccessibilityReport['pageFailures'][number] = {
                  theme,
                  viewport: viewportName,
                  route,
                  url: page.url(),
                  error: error instanceof Error ? error.message : String(error),
                };
                try {
                  const screenshot = resolve(
                    dirname(outputPath),
                    `failure-${theme}-${viewportName}-${routes.indexOf(route)}.png`,
                  );
                  await page.screenshot({
                    path: screenshot,
                    fullPage: true,
                    animations: 'disabled',
                    timeout: 5_000,
                  });
                  entry.screenshot = screenshot;
                } catch (captureError) {
                  entry.error += `; screenshot unavailable: ${String(captureError)}`;
                }
                report.pageFailures.push(entry);
                await writeReport();
                if (!browser.isConnected()) throw error;
              } finally {
                await page.close();
              }
            }
          } finally {
            await visualContext.close();
          }
        }
      }
      Object.assign(
        report,
        summarizeAccessibility(
          themes.flatMap((theme) =>
            viewports.flatMap(([name]) => routes.map((route) => `${theme}|${name}|${route}`)),
          ),
          report.pages,
          report.violations.length,
          report.pageFailures.length,
        ),
      );
      report.current = null;
      report.phase = 'finished';
      if (!report.passed)
        report.failure = 'Accessibility matrix incomplete or serious/critical violations detected';
      await writeReport();
    } catch (error) {
      report.failedPhase = report.phase;
      report.phase = 'failed';
      report.failure = error instanceof Error ? error.message : String(error);
      await writeReport();
      throw error;
    }

    expect(report.pageFailures, 'all routes must load and scan').toEqual([]);
    expect(report.violations, 'axe serious/critical violations').toEqual([]);
    expect(report.complete, 'accessibility matrix must be complete').toBe(true);
  });
});

async function waitForBusinessContent(
  page: Page,
  route: string,
  detailRoute: string,
  fixture: Awaited<ReturnType<typeof seedWorkspace>>,
) {
  const visible = async (locator: ReturnType<Page['getByRole']>) =>
    expect(locator).toBeVisible({ timeout: 30_000 });
  if (route === '/home') {
    await visible(page.getByRole('heading', { name: '继续工作', exact: true }));
    await visible(page.locator('footer[aria-label="工作台状态"]'));
  } else if (route === '/projects')
    await visible(page.getByRole('link').filter({ hasText: 'v1 baseline project' }).first());
  else if (route === '/agents')
    await visible(page.getByRole('heading', { name: 'v1 baseline agent', exact: true }));
  else if (route === '/prompts') await visible(page.getByText('还没有 Prompt', { exact: true }));
  else if (route === '/settings/appearance')
    await visible(page.getByRole('heading', { name: '外观偏好', exact: true }));
  else if (route === '/agents/runtime') {
    await visible(page.getByRole('heading', { name: 'Runtime', exact: true }));
    await visible(page.getByText('Local Host · 就绪', { exact: true }));
  } else if (route === detailRoute) {
    await visible(page.getByRole('complementary', { name: '工作 Inspector' }));
    await visible(page.getByRole('heading', { name: '真实工作详情无障碍检查', exact: true }));
  } else if (route.endsWith('/work'))
    await visible(page.getByRole('button').filter({ hasText: '真实工作详情无障碍检查' }).first());
  else if (route.endsWith('/sessions'))
    await visible(page.getByRole('link').filter({ hasText: 'v1 baseline session' }).first());
  else if (route.endsWith('/overview'))
    await visible(page.getByRole('link').filter({ hasText: 'v1 baseline session' }).first());
  else if (route === `/workspace/${fixture.session.id}`)
    await visible(page.getByRole('heading', { name: '等待第一条指令', exact: true }));
  else throw new Error(`Missing readiness contract for ${route}`);
  await expect(page.getByText(/^正在(加载|读取|汇总|确认)/).filter({ visible: true })).toHaveCount(
    0,
    { timeout: 30_000 },
  );
}
