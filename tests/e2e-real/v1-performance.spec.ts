import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildGitChangeTree } from '../../apps/web/src/features/workspace/components/git-change-tree';
import { filterProjectSessions } from '../../apps/web/src/features/projects/pages/project-session-utils';
import type { SessionRecord } from '../../apps/web/src/lib/api';
import { expect, test } from './fixtures.js';
import { seedWorkspace } from './baseline-support.js';

const execFile = promisify(execFileCallback);
const outputPath = resolve(
  process.env.AGENTHUB_PERFORMANCE_OUTPUT || 'real-test-results/v1-performance.json',
);
const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), '../..');

test.describe('v1 real performance budget', () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ authMode: 'local_trusted' });

  test('captures real browser and production data-transform timings', async ({
    browser,
    context,
    app,
  }) => {
    const report: Record<string, unknown> = {
      source: 'isolated-real-server',
      complete: false,
      origin: app.origin,
      outputPath,
      metrics: {},
      samples: {},
      dataset: { gitEntries: 200, sessionRecords: 500 },
      failure: '',
    };
    const writeReport = async () => {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    };

    try {
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
      report.sourceCommit = stdout.trim();

      const fixture = await seedWorkspace(context, app);
      report.fixtureId = `performance:${fixture.project.id}`;

      const visualContext = await browser.newContext({
        baseURL: app.origin,
        viewport: { width: 1440, height: 1000 },
      });
      await visualContext.addInitScript(() => {
        const target = window as Window & {
          __agenthubLcp?: number;
          __agenthubLcpEntries?: Array<Record<string, unknown>>;
        };
        target.__agenthubLcp = undefined;
        target.__agenthubLcpEntries = [];
        if (!('PerformanceObserver' in window)) return;
        try {
          const observer = new PerformanceObserver((list) => {
            const entry = list.getEntries().at(-1);
            if (entry) {
              target.__agenthubLcp = entry.startTime;
              const lcp = entry as PerformanceEntry & {
                size?: number;
                element?: Element | null;
              };
              target.__agenthubLcpEntries?.push({
                startTime: lcp.startTime,
                size: lcp.size,
                tag: lcp.element?.tagName,
                id: lcp.element?.id,
                text: lcp.element?.textContent?.trim().slice(0, 100),
              });
            }
          });
          observer.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {
          // The metric is reported as unavailable instead of using a proxy.
        }
      });
      const page = await visualContext.newPage();

      await page.goto('/home', { waitUntil: 'load' });
      await expect(
        page.getByRole('heading', { name: /继续工作|从一个 Project 开始/ }),
      ).toBeVisible();
      await page.waitForTimeout(1_000);
      const homeLcp = await page.evaluate(() => {
        const target = window as Window & {
          __agenthubLcp?: number;
          __agenthubLcpEntries?: Array<Record<string, unknown>>;
        };
        return {
          time:
            target.__agenthubLcp ??
            performance.getEntriesByType('largest-contentful-paint').at(-1)?.startTime ??
            null,
          entries: target.__agenthubLcpEntries ?? [],
        };
      });
      const homeLcpMs = homeLcp.time;
      if (typeof homeLcpMs !== 'number') throw new Error('真实 Chromium 未提供 Home LCP');
      const navigation = await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation').at(-1) as
          PerformanceNavigationTiming | undefined;
        const resources = performance
          .getEntriesByType('resource')
          .map((resource) => {
            const item = resource as PerformanceResourceTiming;
            return {
              name: item.name.split('/').at(-1) ?? item.name,
              initiatorType: item.initiatorType,
              startTime: item.startTime,
              responseEnd: item.responseEnd,
              duration: item.duration,
              transferSize: item.transferSize,
            };
          })
          .sort((left, right) => right.responseEnd - left.responseEnd)
          .slice(0, 100);
        return {
          domContentLoaded: entry?.domContentLoadedEventEnd ?? null,
          loadEventEnd: entry?.loadEventEnd ?? null,
          responseEnd: entry?.responseEnd ?? null,
          resources,
        };
      });

      // Prime the lazy route chunk and query cache once. The measured samples below
      // represent a cached route transition, not the first navigation cost.
      await page.getByRole('link', { name: '项目', exact: true }).click();
      await expect(page).toHaveURL(/\/projects$/);
      await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
      await page.getByRole('link', { name: '首页', exact: true }).click();
      await expect(page).toHaveURL(/\/home$/);
      await expect(
        page.getByRole('heading', { name: /继续工作|从一个 Project 开始/ }),
      ).toBeVisible();

      const routeSamples: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const routeReady = page.evaluate(
          () =>
            new Promise<number>((resolveMeasure) => {
              const started = performance.now();
              const check = () => {
                if (
                  location.pathname === '/projects' &&
                  document.querySelector('h1, h2')?.textContent?.trim() === '项目'
                ) {
                  resolveMeasure(performance.now() - started);
                  return;
                }
                requestAnimationFrame(check);
              };
              check();
            }),
        );
        await page.getByRole('link', { name: '项目', exact: true }).click();
        routeSamples.push(await routeReady);
        await page.getByRole('link', { name: '首页', exact: true }).click();
        await expect(page).toHaveURL(/\/home$/);
        await expect(
          page.getByRole('heading', { name: /继续工作|从一个 Project 开始/ }),
        ).toBeVisible();
      }

      await page.goto(`/workspace/${fixture.session.id}`, { waitUntil: 'domcontentloaded' });
      const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令' });
      await expect(composer).toBeVisible();
      const inputSamples: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const measured = page.evaluate(
          () =>
            new Promise<number>((resolveMeasure, rejectMeasure) => {
              const input = document.querySelector('textarea[aria-label="给 Agent 发送工程指令"]');
              if (!(input instanceof HTMLTextAreaElement)) {
                rejectMeasure(new Error('Composer input not found'));
                return;
              }
              const timeout = window.setTimeout(
                () => rejectMeasure(new Error('Composer input response timed out')),
                2_000,
              );
              input.addEventListener(
                'input',
                () => {
                  const started = performance.now();
                  requestAnimationFrame(() => {
                    window.clearTimeout(timeout);
                    resolveMeasure(performance.now() - started);
                  });
                },
                { once: true },
              );
            }),
        );
        await composer.fill(`performance sample ${index}`);
        inputSamples.push(await measured);
      }

      const entries = Array.from({ length: 200 }, (_, index) => ({
        index: '?',
        worktree: '?',
        path: `src/generated/${String(index % 20).padStart(2, '0')}/file-${String(index).padStart(3, '0')}.md`,
        worktreeStats: { additions: 3, deletions: index % 3 },
      }));
      const gitSamples: number[] = [];
      for (let index = 0; index < 22; index += 1) {
        const started = performance.now();
        const tree = buildGitChangeTree(entries);
        gitSamples.push(performance.now() - started);
        expect(tree.length).toBeGreaterThan(0);
      }

      const sessions = createSessionRecords(500);
      const sessionSamples: number[] = [];
      for (let index = 0; index < 22; index += 1) {
        const started = performance.now();
        const filtered = filterProjectSessions(sessions, {
          query: 'performance session 499',
          agentId: 'all',
          status: 'all',
        });
        sessionSamples.push(performance.now() - started);
        expect(filtered).toHaveLength(1);
      }

      const fps = await page.evaluate(async () => {
        const started = performance.now();
        const windows = [0, 0];
        let previous = started;
        let worstFrameMs = 0;
        await new Promise<void>((resolveMeasure) => {
          const frame = (timestamp: number) => {
            const windowIndex = timestamp - started < 500 ? 0 : 1;
            windows[windowIndex] += 1;
            worstFrameMs = Math.max(worstFrameMs, timestamp - previous);
            previous = timestamp;
            if (timestamp - started >= 1_000) resolveMeasure();
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        const duration = performance.now() - started;
        const sustainedFps = windows.map((frames, index) => {
          const windowDuration = Math.min(500, Math.max(1, duration - index * 500));
          return (frames * 1_000) / windowDuration;
        });
        return {
          measuredFps: sustainedFps.reduce((sum, value) => sum + value, 0) / sustainedFps.length,
          minFps: Math.min(...sustainedFps),
          worstFrameMs,
          sustainedFps,
        };
      });
      await page.close();
      await visualContext.close();

      const metrics = {
        homeLcpMs: round(homeLcpMs),
        routeVisibleMs: round(Math.max(...routeSamples)),
        inputResponseMs: round(percentile(inputSamples, 95)),
        gitTreeBuildMs: round(percentile(gitSamples, 95)),
        sessionFilterMs: round(percentile(sessionSamples, 95)),
        minFps: round(fps.minFps),
      };
      report.metrics = metrics;
      report.samples = {
        homeLcpEntries: homeLcp.entries,
        navigation,
        routeSamples,
        inputSamples,
        gitSamples,
        sessionSamples,
        fps,
      };
      report.complete = true;
      await writeReport();

      expect(metrics.homeLcpMs).toBeLessThanOrEqual(2_000);
      expect(metrics.routeVisibleMs).toBeLessThanOrEqual(250);
      expect(metrics.inputResponseMs).toBeLessThanOrEqual(100);
      expect(metrics.gitTreeBuildMs).toBeLessThanOrEqual(50);
      expect(metrics.sessionFilterMs).toBeLessThanOrEqual(50);
      expect(metrics.minFps).toBeGreaterThanOrEqual(40);
    } catch (error) {
      report.failure = error instanceof Error ? error.message : String(error);
      await writeReport();
      throw error;
    }
  });
});

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index] ?? Number.NaN;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function createSessionRecords(count: number): SessionRecord[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    projectId: '00000000-0000-4000-8000-000000000001',
    agentId: '00000000-0000-4000-8000-000000000002',
    taskId: null,
    title: `Performance Session ${index}`,
    cwd: `/workspace/project/${index}`,
    branch: 'main',
    status: 'READY',
    model: 'fixture-model',
    mode: 'agent',
    reasoningEffort: 'low',
    lastActiveAt: new Date(now - index * 1_000).toISOString(),
  }));
}
