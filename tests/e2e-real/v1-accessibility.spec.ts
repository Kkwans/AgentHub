import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.js';
import { seedWorkspace } from './baseline-support.js';

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
  target: string[];
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
  test.describe.configure({ timeout: 1_200_000 });
  test.use({ authMode: 'local_trusted' });

  test('has zero serious or critical axe violations across core routes', async ({
    browser,
    context,
    app,
  }) => {
    test.slow();
    const fixture = await seedWorkspace(context, app);
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
    const report: AccessibilityReport = {
      source: 'isolated-real-server',
      complete: false,
      failure: '',
      sourceCommit,
      baseURL: app.origin,
      fixtureId: `v1-accessibility:${fixture.session.id}`,
      routes,
      viewports: viewports.map(([name]) => name),
      themes: [...themes],
      pages: [],
      violations: [],
      unverified: [
        'keyboard-only full Workspace path',
        'focus return after drawer/dialog',
        'PTY lifecycle and terminal input',
        '200% zoom interaction coverage',
      ],
    };
    await mkdir(dirname(outputPath), { recursive: true });
    const writeReport = async () => {
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    };
    await writeReport();

    try {
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
              const page = await visualContext.newPage();
              try {
                await page.emulateMedia({ reducedMotion: 'reduce' });
                await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                await expect(page.locator('main, .workspace-shell').first()).toBeVisible({
                  timeout: 30_000,
                });
                // Avoid sampling a control while the shell or route transition is still settling.
                await page.waitForTimeout(250);
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
                    impact: violation.impact,
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
                for (const violation of violations) {
                  report.violations.push({ ...violation, theme, viewport: viewportName, route });
                }
                await writeReport();
                console.log(
                  `accessibility ${report.pages.length}/${routes.length * themes.length * viewports.length}: ${theme} ${viewportName} ${route}`,
                );
              } finally {
                await page.close();
              }
            }
          } finally {
            await visualContext.close();
          }
        }
      }
      report.complete = report.pages.length === routes.length * themes.length * viewports.length;
      await writeReport();
    } catch (error) {
      report.failure = error instanceof Error ? error.message : String(error);
      await writeReport();
      throw error;
    }

    expect(report.violations, 'axe serious/critical violations').toEqual([]);
    expect(report.complete, 'accessibility matrix must be complete').toBe(true);
  });
});
