import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { apiData, seedWorkspace } from './baseline-support.js';
import { test, expect } from './fixtures.js';

const execFile = promisify(execFileCallback);
const { measureLayout, writeAudit } = createRequire(import.meta.url)(
  '../../scripts/qa/visual-evidence.cjs',
);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 1000 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];
const themes = ['light', 'dark'];
type Identified = { id: string };

test.describe('v1 isolated Workspace state baseline', () => {
  test.describe.configure({ timeout: 1_200_000 });
  // Keep the deliberately hanging Run alive across the serial screenshot matrix.
  // This changes only this disposable server, within the existing 600s contract.
  test.use({ authMode: 'local_trusted', acpPromptTimeoutMs: 600_000 });

  test('captures real run, approval, failure, closed, Git and Terminal capability states', async ({
    browser,
    context,
    app,
  }) => {
    test.setTimeout(1_200_000);
    const fixture = await seedWorkspace(context, app);
    const serverHealth = await apiData(context, 'get', '/health');
    const { terminal: terminalCapability } = await apiData<{
      terminal: { available: boolean; code: string };
    }>(context, 'get', '/settings/capabilities');
    const { stdout } = await execFile('/usr/bin/git', [
      '-c',
      `safe.directory=${repositoryRoot}`,
      '-C',
      repositoryRoot,
      'rev-parse',
      'HEAD',
    ]);
    const sourceCommit = stdout.trim();
    const outputDir = resolve(
      process.env.AGENTHUB_VISUAL_OUTPUT ||
        `docs/qa/visual/v1.0.0/00-workspace-states-${Date.now()}`,
    );
    await mkdir(outputDir, { recursive: false });
    const makeSession = (title: string, agentId = fixture.agent.id) =>
      apiData<Identified>(context, 'post', '/sessions', {
        projectId: fixture.project.id,
        agentId,
        title,
        cwd: app.projectRoot,
        branch: 'main',
      });
    const makeAgent = async (flag: string) => {
      const agent = await apiData<Identified>(context, 'post', '/agents', {
        name: `State fixture ${flag}`,
        targetId: fixture.target.id,
        agentKind: 'CUSTOM_ACP',
        executable: process.execPath,
        args: [resolve(repositoryRoot, 'tests/fixtures/acp/fake-agent.mjs'), flag],
      });
      const result = await apiData<{ status: string }>(
        context,
        'post',
        `/agents/${agent.id}/preflight`,
        { cwd: app.projectRoot },
      );
      expect(result.status).toBe('READY');
      return agent;
    };
    const runningAgent = await makeAgent('--hang-prompt');
    // The fixture's transport diagnostic is normalized by AcpAdapter into a
    // terminal FAILED Run, unlike a process crash which correctly becomes
    // DISCONNECTED.
    const failedAgent = await makeAgent('--transport-warning');
    const sessions = {
      ready: fixture.session,
      running: await makeSession('Baseline running', runningAgent.id),
      approval: await makeSession('Baseline approval'),
      failed: await makeSession('Baseline failed', failedAgent.id),
      closed: await makeSession('Baseline closed'),
      'git-changes': await makeSession('Baseline Git changes'),
      terminal: await makeSession('Baseline Terminal'),
    };
    await apiData(context, 'post', `/sessions/${sessions.closed.id}/close`);
    await writeFile(
      join(app.projectRoot, 'README.md'),
      '# AgentHub real E2E\n\nBaseline Git change.\n',
    );
    const routes = Object.values(sessions).map((session) => `/workspace/${session.id}`);
    const pages: Record<string, unknown>[] = [];
    const report = {
      source: 'isolated-real-server',
      sourceCommit,
      workingTreeChanges: [
        'tests/e2e-real/fixtures.ts',
        'tests/e2e-real/v1-baseline.spec.ts',
        'tests/e2e-real/baseline-support.ts',
        'tests/e2e-real/v1-workspace-states.spec.ts',
      ],
      origin: app.origin,
      serverHealth,
      terminalCapability,
      fixtureId: `workspace-states:${fixture.project.id}`,
      fixtureAgent: 'ACP protocol test agent; not a live production Agent',
      complete: false,
      routes,
      themes,
      viewports: viewports.map((v) => `${v.width}x${v.height}`),
      pages,
      activeSnapshot: '',
      failure: '',
      unverifiedStates: [
        'login',
        'loading',
        'error',
        'offline',
        ...(terminalCapability.available ? [] : ['terminal-pty-open-input-resize-close']),
      ],
    };
    writeAudit(outputDir, report);
    const startedRuns: { sessionId: string; id: string }[] = [];
    try {
      for (const state of ['running', 'approval', 'failed'] as const) {
        const sessionId = sessions[state].id;
        const run = await apiData<Identified>(context, 'post', `/sessions/${sessionId}/runs`, {
          text: `Capture baseline ${state}`,
        });
        startedRuns.push({ sessionId, id: run.id });
        const expected = { running: 'RUNNING', approval: 'WAITING_APPROVAL', failed: 'FAILED' }[
          state
        ];
        await expect
          .poll(
            async () => {
              const runs = await apiData<{ status: string }[]>(
                context,
                'get',
                `/sessions/${sessionId}/runs`,
              );
              return runs.at(-1)?.status;
            },
            { timeout: 30_000 },
          )
          .toBe(expected);
      }
      for (const theme of themes) {
        for (const viewport of viewports) {
          const viewportName = `${viewport.width}x${viewport.height}`;
          if (
            process.env.AGENTHUB_VISUAL_VIEWPORT &&
            process.env.AGENTHUB_VISUAL_VIEWPORT !== viewportName
          )
            continue;
          if (process.env.AGENTHUB_VISUAL_THEME && process.env.AGENTHUB_VISUAL_THEME !== theme)
            continue;
          const visualContext = await browser.newContext({ baseURL: app.origin, viewport });
          await visualContext.addInitScript(
            ({ origin, theme }) => {
              if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
            },
            { origin: app.origin, theme },
          );
          try {
            for (const [state, session] of Object.entries(sessions)) {
              const page = await visualContext.newPage();
              const route = `/workspace/${session.id}`;
              report.activeSnapshot = `${theme}/${viewportName}/${state}`;
              writeAudit(outputDir, report);
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
              await expect(page.locator('.workspace-shell')).toBeVisible({ timeout: 30_000 });
              const banners: Record<string, string> = {
                running: 'Agent 正在执行',
                approval: '等待你的批准',
                failed: '最近一次 Run 失败',
                closed: 'Session 已关闭',
              };
              const expectedBanner = banners[state];
              const banner = expectedBanner
                ? page.getByRole('region', { name: `当前运行状态：${expectedBanner}` })
                : undefined;
              // Keep the baseline even when a known state is not rendered: the
              // missing banner is evidence for the subsequent UI phase, not a
              // reason to discard the real backend state and its screenshot.
              const bannerFound = banner ? await banner.isVisible().catch(() => false) : false;
              if (banner && state !== 'failed')
                await expect(banner).toBeVisible({ timeout: 30_000 });
              if (state === 'approval')
                await expect(page.getByRole('button', { name: '允许一次' })).toBeVisible();
              let gitFileSelectionFound = false;
              if (state === 'git-changes') {
                // The status is captured as evidence. The inspector's drawer
                // interaction is a separate responsive gate and remains
                // unverified when the checkbox is outside the current view.
                gitFileSelectionFound = await page
                  .getByLabel('选择 README.md')
                  .isVisible()
                  .catch(() => false);
              }
              if (state === 'terminal') {
                if (!terminalCapability.available) {
                  await expect(
                    page.getByRole('button', { name: /^打开 Terminal，不可用：/ }),
                  ).toBeDisabled();
                } else {
                  await page.getByRole('button', { name: '打开 Terminal', exact: true }).click();
                  await expect(page.locator('.terminal-dock-shell .xterm-screen')).toBeVisible({
                    timeout: 30_000,
                  });
                  await expect(page.getByText('正在打开 Terminal…')).not.toBeVisible();
                  await expect(page.locator('.terminal-dock-shell [role="alert"]')).toHaveCount(0);
                }
              }
              await page.evaluate(() => document.fonts.ready);
              const filename = `${theme}-${state}-${viewportName}.png`;
              await page.screenshot({ path: join(outputDir, filename), timeout: 30_000 });
              pages.push({
                theme,
                viewport: viewportName,
                route,
                state,
                filename,
                sourceCommit,
                serverHealth,
                fixtureId: report.fixtureId,
                consoleErrors,
                pageErrors,
                failedRequests,
                stateEvidence: { expectedBanner, bannerFound, gitFileSelectionFound },
                layout: await page.evaluate(measureLayout),
              });
              writeAudit(outputDir, report);
              console.log(`state baseline ${pages.length}/98: ${report.activeSnapshot}`);
              await page.close();
            }
          } finally {
            await visualContext.close();
          }
        }
      }
      report.complete = pages.length === routes.length * themes.length * viewports.length;
    } catch (error) {
      report.failure = error instanceof Error ? error.message.slice(0, 1000) : String(error);
      throw error;
    } finally {
      writeAudit(outputDir, report);
      for (const run of startedRuns) {
        await apiData(context, 'post', `/sessions/${run.sessionId}/runs/${run.id}/cancel`);
      }
    }
  });
});
