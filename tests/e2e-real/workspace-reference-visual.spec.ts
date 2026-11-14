import { execFile as execFileCallback } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Page, TestInfo } from '@playwright/test';
import { apiData } from './baseline-support.js';
import { test, expect, initializeGitProject } from './fixtures.js';

const execFile = promisify(execFileCallback);
type Id = { id: string };
test.use({ authMode: 'local_trusted' });
test.setTimeout(180_000);

async function capture(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const geometry = await page.locator('.conversation-scroll').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    }),
  );
  await info.attach(`${name}-geometry`, {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function showChanges(page: Page, width: number) {
  if (width < 768) {
    // A tool's real file action opens the mobile inspector. Its modal hides
    // the background Workspace tabs; close through the actual drawer control
    // before choosing Git, rather than clicking a hidden background tab.
    const closeInspector = page.getByRole('button', { name: '关闭检查器', exact: true });
    if (await closeInspector.isVisible()) await closeInspector.click();
    await expect(page.getByRole('tablist', { name: 'Workspace 视图' })).toBeVisible();
    await page
      .getByRole('tablist', { name: 'Workspace 视图' })
      .getByRole('tab', { name: 'Git', exact: true })
      .click();
    return;
  }
  if (width < 1180) {
    const open = page.getByRole('button', { name: '打开辅助栏', exact: true });
    if (await open.isVisible()) await open.click();
    await page
      .getByRole('tablist', { name: '辅助栏视图' })
      .getByRole('tab', { name: '检查器', exact: true })
      .click();
  }
  await page
    .getByRole('tablist', { name: '检查器视图' })
    .getByRole('tab', { name: '变更', exact: true })
    .click();
}

async function assertCompactPhoneInspector(page: Page, info: TestInfo) {
  for (const phoneWidth of [320, 390]) {
    await page.setViewportSize({ width: phoneWidth, height: 844 });
    const panel = page.locator('.inspector-panel');
    const list = page.getByRole('tablist', { name: '检查器视图' });
    const close = page.getByRole('button', { name: '关闭检查器', exact: true });
    const titles = { 变更: '审阅更改', 文件: '项目文件', 活动: '会话活动', Run: '运行详情' };
    for (const [label, title] of Object.entries(titles)) {
      const tab = list.getByRole('tab', { name: label, exact: true });
      await tab.focus();
      await page.keyboard.press('Enter');
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      // Hidden visually, not removed from heading navigation or aria-hidden.
      const heading = panel.getByRole('heading', { name: title, exact: true });
      await expect(heading).toHaveCount(1);
      await expect(heading.locator('..')).toHaveCSS('clip-path', 'inset(50%)');
      const panelBox = (await panel.boundingBox())!;
      const listBox = (await list.boundingBox())!;
      const closeBox = (await close.boundingBox())!;
      expect(listBox.y - panelBox.y).toBeLessThanOrEqual(1);
      expect(listBox.height).toBeLessThanOrEqual(56);
      expect(closeBox.width).toBeGreaterThanOrEqual(44);
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
      expect(closeBox.y).toBeGreaterThanOrEqual(listBox.y);
      expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(listBox.y + listBox.height);
      for (const item of await list.getByRole('tab').all()) {
        const box = (await item.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(closeBox.x);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
    }
    await list.getByRole('tab', { name: '变更', exact: true }).click();
    await capture(page, info, `compact-inspector-${phoneWidth}`);
    await close.focus();
    await page.keyboard.press('Escape');
    await expect(close).not.toBeVisible();
    await showChanges(page, phoneWidth);
    await expect(close).toBeFocused();
    await close.click();
    await expect(close).not.toBeVisible();
    await showChanges(page, phoneWidth);
  }
}

async function assertCompactTabletInspector(page: Page, info: TestInfo, width: number) {
  const toolbar = page.locator('.tablet-inspector-toolbar');
  const list = toolbar.getByRole('tablist', { name: '检查器视图' });
  const close = toolbar.getByRole('button', { name: '关闭检查器', exact: true });
  const focus = toolbar.getByRole('button', { name: '专注审阅', exact: true });
  const measure = async () => {
    const { row, controls, overflow } = await toolbar.evaluate((element) => {
      const rect = (node: Element) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        row: rect(element),
        controls: [
          ...element.querySelectorAll('[role="tab"]'),
          element.querySelector('.workspace-review-focus')!,
          element.querySelector('.workspace-drawer-close')!,
        ].map(rect),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(row.height).toBeLessThanOrEqual(56);
    expect(controls).toHaveLength(6);
    let right = row.x;
    for (const box of controls) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(right);
      expect(box.y).toBeGreaterThanOrEqual(row.y);
      expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height);
      expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);
      right = box.x + box.width;
    }
    expect(overflow).toBeLessThanOrEqual(1);
  };
  for (const [label, title] of Object.entries({
    变更: '审阅更改',
    文件: '项目文件',
    活动: '会话活动',
    Run: '运行详情',
  })) {
    const tab = list.getByRole('tab', { name: label, exact: true });
    await tab.focus();
    await page.keyboard.press('Enter');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(toolbar.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
    await measure();
  }
  await list.getByRole('tab', { name: '变更', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(focus).toBeFocused();
  await page.keyboard.press('Enter');
  const exit = toolbar.getByRole('button', { name: '退出专注审阅', exact: true });
  await expect(exit).toHaveAttribute('aria-pressed', 'true');
  await expect(exit).toBeFocused();
  await measure();
  await exit.click();
  await expect(focus).toHaveAttribute('aria-pressed', 'false');
  await expect(focus).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await capture(page, info, `compact-tablet-inspector-${width}`);
  await page.keyboard.press('Escape');
  await expect(close).not.toBeVisible();
  await expect(page.getByRole('button', { name: '打开辅助栏', exact: true })).toBeFocused();
  await showChanges(page, width);
  await close.click();
  await expect(close).not.toBeVisible();
  await expect(page.getByRole('button', { name: '打开辅助栏', exact: true })).toBeFocused();
  await showChanges(page, width);
}

for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`参考构图：合成中文对话与实际 Git 差异 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await initializeGitProject(app.projectRoot);
      // This repository belongs exclusively to this disposable real-service fixture.
      const git = (args: string[]) =>
        execFile('/usr/bin/git', ['-C', app.projectRoot, ...args], {
          env: {
            PATH: '/usr/bin:/bin',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
          },
        });
      await writeFile(
        join(app.projectRoot, 'runner.ts'),
        'export function runStep() {\n  return "continue";\n}\n',
      );
      await writeFile(
        join(app.projectRoot, 'task.ts'),
        'export const cancellationPolicy = "none";\n',
      );
      await writeFile(
        join(app.projectRoot, 'cancel.test.ts'),
        '// Synthetic example only.\nexport const expectedAfterCancel = "continue";\n',
      );
      await git(['add', '--', 'runner.ts', 'task.ts', 'cancel.test.ts']);
      await git(['commit', '-m', 'test: seed disposable cancellation example']);
      const target = await apiData<Id>(context, 'post', '/execution-targets', {
        name: '演示主机',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const project = await apiData<Id>(context, 'post', '/projects', {
        name: 'AgentHub 演示项目',
        targetId: target.id,
        rootPath: app.projectRoot,
        kind: 'TEST',
      });
      const agent = await apiData<Id>(context, 'post', '/agents', {
        name: '合成演示适配器',
        targetId: target.id,
        agentKind: 'CUSTOM_ACP',
        executable: process.execPath,
        args: [
          new URL('../fixtures/acp/fake-agent.mjs', import.meta.url).pathname,
          '--reference-visual',
        ],
      });
      expect(
        (
          await apiData<{ status: string }>(context, 'post', `/agents/${agent.id}/preflight`, {
            cwd: app.projectRoot,
            smokeSession: false,
          })
        ).status,
      ).toBe('READY');
      const session = await apiData<Id>(context, 'post', '/sessions', {
        projectId: project.id,
        agentId: agent.id,
        title: '修复任务取消状态 · 合成演示',
        cwd: app.projectRoot,
        branch: 'main',
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.goto(`/workspace/${session.id}`);
      const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
      await expect(composer).toBeEnabled({ timeout: 30_000 });
      if (width < 768) {
        const header = (await page.locator('.workspace-contextbar').boundingBox())!;
        expect(header.height).toBeGreaterThanOrEqual(55.99);
        expect(header.height).toBeLessThanOrEqual(60);
        const controls = [];
        for (const name of ['搜索已保存文字', '更多会话操作']) {
          const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(43.99);
          expect(box.height).toBeGreaterThanOrEqual(43.99);
          expect(box.y).toBeGreaterThanOrEqual(header.y - 0.01);
          expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height + 0.01);
          controls.push(box);
        }
        expect(controls[0]!.x + controls[0]!.width).toBeLessThanOrEqual(controls[1]!.x + 0.01);
      }

      await composer.fill('合成演示数据，非真实 Agent 执行：展示取消任务后的中断检查。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect
        .poll(
          async () =>
            (
              await apiData<{ status: string }[]>(context, 'get', `/sessions/${session.id}/runs`)
            ).map((run) => run.status),
          { timeout: 30_000 },
        )
        .toEqual(['COMPLETED']);
      await expect
        .poll(
          async () =>
            (await apiData<{ status: string }>(context, 'get', `/sessions/${session.id}`)).status,
          { timeout: 30_000 },
        )
        .toBe('READY');
      await expect(composer).toBeEnabled();
      // Plans share the card surface, but are not tool executions. Count only
      // the renderer's actual tool-event rows and verify every exact title.
      const tools = page.locator('.tool-event-row .tool-entry-card');
      await expect(tools).toHaveCount(4);
      await expect(page.locator('.plan-event-row')).toHaveCount(1);
      await expect(page.locator('.plan-event-row summary')).toHaveText('执行计划 · 3/3 完成');
      const planProgress = page.getByRole('progressbar', { name: '执行计划 3/3 完成' });
      await expect(planProgress).toHaveAttribute('aria-valuenow', '3');
      await expect(planProgress).toHaveAttribute('data-complete', 'true');
      await expect(planProgress).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(planProgress).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      await expect(planProgress).toHaveCSS('box-shadow', 'none');
      await expect(planProgress.locator('.composer-plan-track')).toBeVisible();
      await expect(planProgress.locator('.composer-plan-track-fill')).toHaveCSS(
        'transform',
        'matrix(1, 0, 0, 1, 0, 0)',
      );
      expect(await planProgress.evaluate((node) => node.tabIndex)).toBe(-1);

      await expect(page.locator('.plan-event-row summary')).toHaveAccessibleName(
        '执行计划 · 3/3 完成，展开执行计划详情',
      );
      for (const label of ['读取代码', '编辑文件', '测试结果（合成）', '静态检查（合成）']) {
        const heading = tools
          .locator('.tool-entry-badge')
          .filter({ hasText: new RegExp(`^${label}$`) });
        await expect(heading).toHaveCount(1);
        await expect(heading).toHaveText(label);
        if (width === 390) {
          await expect(heading).toHaveCSS('font-size', '14px');
          expect(
            await heading.evaluate((node) => node.scrollWidth - node.clientWidth),
          ).toBeLessThanOrEqual(1);
        }
      }
      if (width === 390) {
        for (const card of await tools.all()) {
          const toggle = card.locator('button[aria-expanded]').first();
          const toggleBox = (await toggle.boundingBox())!;
          expect(toggleBox.width).toBeGreaterThanOrEqual(43.99);
          expect(toggleBox.height).toBeGreaterThanOrEqual(43.99);
          const summary = card.locator('.tool-entry-summary');
          if (await summary.count()) {
            await expect(summary).toHaveCSS('text-overflow', 'ellipsis');
            const geometry = await card.evaluate((node) => {
              const summary = node.querySelector<HTMLElement>('.tool-entry-summary')!;
              const title = node.querySelector<HTMLElement>('.tool-entry-badge')!;
              const toggle = node.querySelector<HTMLElement>('button[aria-expanded]')!;
              const rect = (element: HTMLElement) => {
                const box = element.getBoundingClientRect();
                return {
                  x: box.x,
                  y: box.y,
                  right: box.right,
                  bottom: box.bottom,
                  width: box.width,
                };
              };
              return { summary: rect(summary), title: rect(title), toggle: rect(toggle) };
            });
            expect(geometry.summary.width).toBeGreaterThan(0);
            expect(Math.abs(geometry.summary.x - geometry.title.x)).toBeLessThanOrEqual(1);
            expect(geometry.summary.y).toBeGreaterThanOrEqual(geometry.title.bottom);
            for (const text of [geometry.title, geometry.summary]) {
              expect(text.x).toBeGreaterThanOrEqual(geometry.toggle.x);
              expect(text.y).toBeGreaterThanOrEqual(geometry.toggle.y);
              expect(text.right).toBeLessThanOrEqual(geometry.toggle.right);
              expect(text.bottom).toBeLessThanOrEqual(geometry.toggle.bottom);
            }
          }
          const file = card.getByRole('button', { name: /^在文件面板中打开：/ });
          if (await file.count()) {
            const fileBox = (await file.boundingBox())!;
            expect(fileBox.width).toBeGreaterThanOrEqual(43.99);
            expect(fileBox.height).toBeGreaterThanOrEqual(43.99);
            expect(fileBox.x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width);
          }
        }
      }
      if (width >= 768) {
        for (const card of await tools.all()) {
          if (!(await card.locator('.tool-entry-summary').count())) continue;
          const geometry = await card.evaluate((node) => {
            const summary = node.querySelector('.tool-entry-summary')!.getBoundingClientRect();
            const title = node.querySelector('.tool-entry-badge')!.getBoundingClientRect();
            return {
              summaryX: summary.x,
              summaryY: summary.y,
              summaryBottom: summary.bottom,
              titleRight: title.right,
              titleY: title.y,
              titleBottom: title.bottom,
            };
          });
          expect(geometry.summaryX).toBeGreaterThanOrEqual(geometry.titleRight);
          expect(geometry.summaryY).toBeLessThan(geometry.titleBottom);
          expect(geometry.titleY).toBeLessThan(geometry.summaryBottom);
        }
      }
      if (width === 390) {
        for (const [label, name] of [
          ['读取代码', 'runner.ts'],
          ['编辑文件', 'task.ts'],
        ]) {
          const card = tools.filter({
            has: page.locator('.tool-entry-badge').filter({ hasText: new RegExp(`^${label}$`) }),
          });
          const summary = card.locator('.tool-entry-summary');
          await expect(summary).toHaveText(name!);
          await expect(summary).toHaveAttribute('title', join(app.projectRoot, name!));
          // A short basename must actually fit, not merely exist behind ellipsis.
          expect(
            await summary.evaluate((node) => node.scrollWidth - node.clientWidth),
          ).toBeLessThanOrEqual(1);
          await expect(
            card.getByRole('button', {
              name: `在文件面板中打开：${join(app.projectRoot, name!)}`,
              exact: true,
            }),
          ).toHaveCount(1);
        }
      }
      await expect(page.locator('.thinking-event-row')).toHaveCount(0);
      await expect(
        page.getByText('合成演示数据，非真实 Agent 执行。', { exact: true }),
      ).toBeVisible();
      const messages = await apiData<{ role: string; text: string }[]>(
        context,
        'get',
        `/sessions/${session.id}/messages?limit=100`,
      );
      expect(
        messages.some(
          (message) => message.role === 'ASSISTANT' && message.text.includes('具体计划'),
        ),
      ).toBe(true);
      const intro = page.locator('article.message-assistant').filter({ hasText: '具体计划：' });
      const conclusion = page.getByText(
        '演示改动已准备好。右侧展示临时 Git 项目的实际差异，请检查取消分支与示例用例。',
        { exact: true },
      );
      await expect(intro).toHaveCount(1);
      await expect(conclusion).toHaveCount(1);
      await expect(page.locator('article.message-assistant[data-message-id]')).toHaveCount(1);
      const causalOrder = await page.evaluate(() => {
        const messages = [...document.querySelectorAll('article.message-assistant')];
        const tools = [...document.querySelectorAll('.tool-event-row')];
        const first = messages.find((node) => node.textContent?.includes('具体计划：'))!;
        const last = messages.find((node) => node.textContent?.includes('演示改动已准备好。'))!;
        return {
          introBeforeTools: Boolean(
            first.compareDocumentPosition(tools[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          conclusionAfterTools: Boolean(
            tools.at(-1)!.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        };
      });
      expect(causalOrder).toEqual({ introBeforeTools: true, conclusionAfterTools: true });
      await intro.scrollIntoViewIfNeeded();
      await capture(page, info, `reference-opening-${theme}-${width}`);
      const diff = await apiData<{ patch: string }>(
        context,
        'get',
        `/projects/${project.id}/git/diff`,
      );
      expect(diff.patch).toContain('+  if (cancelled) return "stopped";');
      for (const file of ['runner.ts', 'task.ts', 'cancel.test.ts'])
        expect(diff.patch).toContain(file);
      await composer.fill('继续检查取消后的状态传播。');
      // Capture the real conversation separately before opening narrow-screen review.
      await capture(page, info, `reference-conversation-${theme}-${width}`);
      if (width === 390) {
        // The presentation basename must not replace the original action path.
        const fileRead = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/v1/projects/${project.id}/files/content`,
        );
        await tools
          .filter({ has: page.locator('.tool-entry-badge').filter({ hasText: /^读取代码$/ }) })
          .getByRole('button', {
            name: `在文件面板中打开：${join(app.projectRoot, 'runner.ts')}`,
            exact: true,
          })
          .click();
        await expect
          .poll(() => new URL(page.url()).searchParams.get('file'))
          .toBe(join(app.projectRoot, 'runner.ts'));
        expect(new URL(page.url()).searchParams.get('view')).toBe('files');
        const response = await fileRead;
        expect(response.status()).toBe(200);
        expect(new URL(response.url()).searchParams.get('path')).toBe('runner.ts');
        const loaded = (await response.json()) as { data: { path: string; content: string } };
        expect(loaded.data.path).toBe('runner.ts');
        expect(loaded.data.content).toContain('if (cancelled)');
      }
      await showChanges(page, width);
      if (width === 390) await assertCompactPhoneInspector(page, info);
      if (width === 768 || width === 1024) await assertCompactTabletInspector(page, info, width);
      if (width >= 768) {
        const focus = page.getByRole('button', { name: '专注审阅', exact: true });
        await expect(focus).toHaveCount(1);
        await expect(focus).toHaveAttribute('title', '临时扩大代码阅读区，不改变保存的栏宽');
        await expect(focus.locator('svg[aria-hidden="true"]')).toHaveCount(1);
        const focusBox = (await focus.boundingBox())!;
        expect(focusBox.width).toBeGreaterThanOrEqual(43.99);
        expect(focusBox.height).toBeGreaterThanOrEqual(43.99);
      }
      if (width === 1440) {
        const divider = page.getByRole('separator', { name: '调整右栏宽度', exact: true });
        await expect(divider).toHaveAttribute(
          'title',
          '拖动调整右栏宽度；聚焦后使用左右方向键，Home 最窄，End 最宽',
        );
        // Read the resting affordance, not its hover/focus enhancement.
        await page.mouse.move(300, 100);
        const grip = divider.locator('[data-resize-grip="right"]');
        await expect(grip).toBeVisible();
        const appearance = await grip.evaluate((node) => {
          const style = getComputedStyle(node);
          const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
          const luminance = (color: string) =>
            rgb(color).reduce((sum, value, index) => {
              const channel = value / 255;
              return (
                sum +
                (index === 0 ? 0.2126 : index === 1 ? 0.7152 : 0.0722) *
                  (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
              );
            }, 0);
          const foreground = luminance(style.color),
            background = luminance(style.backgroundColor);
          return {
            color: style.color,
            background: style.backgroundColor,
            opacity: style.opacity,
            contrast:
              (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
          };
        });
        expect(Number(appearance.opacity)).toBe(1);
        expect(appearance.contrast).toBeGreaterThanOrEqual(3);
        expect(appearance.width).toBeGreaterThan(0);
        expect(appearance.height).toBeGreaterThan(0);
        await info.attach(`review-affordance-${theme}-${width}`, {
          body: JSON.stringify(appearance),
          contentType: 'application/json',
        });
      }
      const gitWrites: string[] = [];
      page.on('request', (request) => {
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          new URL(request.url()).pathname.startsWith(`/api/v1/projects/${project.id}/git/`)
        )
          gitWrites.push(request.method() + ' ' + new URL(request.url()).pathname);
      });
      await page.getByRole('button', { name: '查看 runner.ts Diff', exact: true }).click();
      const review = page.getByRole('region', { name: '已选择 runner.ts 的 Diff', exact: true });
      await expect(review).toBeVisible({ timeout: 30_000 });
      const fileTree = page.locator('.git-change-list[role="tree"]');
      await expect(fileTree).toHaveCount(1);
      await expect(fileTree).toBeHidden();
      const readingOffset = () =>
        review.evaluate(
          (node) =>
            node.getBoundingClientRect().top -
            node.closest('.git-inspector')!.getBoundingClientRect().top,
        );
      const collapsedOffset = await readingOffset();
      await page.getByRole('button', { name: '展开文件清单', exact: true }).click();
      await expect(fileTree).toBeVisible();
      const expandedOffset = await readingOffset();
      const treeHeight = (await fileTree.boundingBox())!.height;
      expect(expandedOffset - collapsedOffset).toBeGreaterThanOrEqual(treeHeight - 1);
      await page.getByRole('button', { name: '收起文件清单', exact: true }).click();
      await expect(fileTree).toBeHidden();
      await expect(review.getByRole('group', { name: '变更文件导航' })).toContainText('2 / 3');
      for (const name of ['上一个变更文件', '下一个变更文件']) {
        const box = (await review.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(43.99);
        expect(box.height).toBeGreaterThanOrEqual(43.99);
      }
      await review.getByRole('button', { name: '下一个变更文件' }).click();
      const nextReview = page.getByRole('region', { name: '已选择 task.ts 的 Diff', exact: true });
      await expect(nextReview).toBeVisible();
      await nextReview.getByRole('button', { name: '上一个变更文件' }).click();
      await expect(review).toBeVisible();
      await info.attach(`reading-priority-${theme}-${width}`, {
        body: JSON.stringify({ collapsedOffset, expandedOffset, treeHeight }),
        contentType: 'application/json',
      });
      expect(gitWrites).toEqual([]);

      const displaySummary = page.locator('.git-inspector summary').filter({ hasText: '显示选项' });
      await expect(displaySummary).toHaveCount(1);
      const displayDetails = displaySummary.locator('..');
      await expect(displayDetails).not.toHaveAttribute('open', '');
      const initialCode = review.locator(
        '.git-diff-editor .editor.modified .view-lines[role="presentation"]',
      );
      await expect(initialCode).toBeVisible({ timeout: 30_000 });
      const compactCodeTop = (await initialCode.boundingBox())!.y;
      await displaySummary.focus();
      await page.keyboard.press('Enter');
      await expect(displayDetails).toHaveAttribute('open', '');
      const options = page.getByRole('group', { name: '文件 Diff 显示选项' });
      await expect(options).toHaveCount(1);
      await expect(review.locator(':scope > .git-diff-toolbar')).toHaveCount(0);
      await expect(review.locator('.git-selected-diff-heading code')).toHaveText('runner.ts');
      // `has` locators are evaluated from each candidate, not from the page.
      // Keep the label scoped once, then verify its actual named checkbox.
      const stagedToggle = options.locator('label.git-diff-toggle');
      await expect(stagedToggle).toHaveCount(1);
      const stagedCheckbox = stagedToggle.getByRole('checkbox', { name: '已暂存', exact: true });
      await expect(stagedCheckbox).toHaveCount(1);
      await expect(stagedCheckbox).toBeVisible();
      const controls = [
        stagedToggle,
        options.getByRole('combobox', { name: 'Diff 空白处理' }),
        options.getByRole('button', { name: '切换为分栏 Diff' }),
      ];
      const controlsGeometry = [];
      for (const control of controls) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(43.99);
        expect(box.width).toBeGreaterThanOrEqual(43.99);
        controlsGeometry.push(box);
      }
      for (let i = 0; i < controlsGeometry.length; i++)
        for (let j = i + 1; j < controlsGeometry.length; j++) {
          const a = controlsGeometry[i]!,
            b = controlsGeometry[j]!;
          expect(
            a.x + a.width <= b.x + 1 ||
              b.x + b.width <= a.x + 1 ||
              a.y + a.height <= b.y + 1 ||
              b.y + b.height <= a.y + 1,
          ).toBe(true);
        }
      await expect
        .poll(async () => (await initialCode.boundingBox())!.y - compactCodeTop)
        .toBeGreaterThanOrEqual(40);
      const expandedCodeTop = (await initialCode.boundingBox())!.y;
      await displaySummary.focus();
      await page.keyboard.press('Enter');
      await expect(displayDetails).not.toHaveAttribute('open', '');
      await expect
        .poll(async () => Math.abs((await initialCode.boundingBox())!.y - compactCodeTop))
        .toBeLessThanOrEqual(1);
      await info.attach('display-options-reading-height', {
        body: JSON.stringify({ compactCodeTop, expandedCodeTop }),
        contentType: 'application/json',
      });
      const surfaceGeometry = await review.evaluate((element) => {
        const surface = element.getBoundingClientRect();
        const inspector = element.closest('.git-inspector')!.getBoundingClientRect();
        const css = getComputedStyle(element);
        return {
          surfaceWidth: surface.width,
          inspectorWidth: inspector.width,
          insetLeft: surface.left - inspector.left,
          insetRight: inspector.right - surface.right,
          paddingLeft: css.paddingLeft,
          paddingRight: css.paddingRight,
          controls: element.querySelectorAll('.git-diff-editor-toolbar').length,
        };
      });
      expect(Math.abs(surfaceGeometry.insetLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(surfaceGeometry.insetRight)).toBeLessThanOrEqual(1);
      expect(surfaceGeometry.paddingLeft).toBe('0px');
      expect(surfaceGeometry.paddingRight).toBe('0px');
      expect(surfaceGeometry.controls).toBe(0);
      await info.attach('reference-review-surface-geometry', {
        body: JSON.stringify({ surfaceGeometry, controlsGeometry }),
        contentType: 'application/json',
      });

      // Monaco also gives its non-code gutter a .monaco-editor class. Assert
      // the real modified code layer, not whichever shared-class node comes first.
      const modified = review.locator('.git-diff-editor .editor.modified');
      const code = modified.locator('.view-lines[role="presentation"]');
      await expect(code).toBeVisible({ timeout: 30_000 });
      await expect(code).toContainText('if (cancelled)');
      await expect(code).toContainText('"stopped"');
      await code.scrollIntoViewIfNeeded();
      const codeGeometry = await code.evaluate((element) => {
        const code = element.getBoundingClientRect();
        const pane = element.closest('.editor.modified')!.getBoundingClientRect();
        let left = Math.max(pane.left, 0),
          right = Math.min(pane.right, innerWidth);
        let top = Math.max(pane.top, 0),
          bottom = Math.min(pane.bottom, innerHeight);
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent),
            bounds = parent.getBoundingClientRect();
          if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowX)) {
            left = Math.max(left, bounds.left);
            right = Math.min(right, bounds.right);
          }
          if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowY)) {
            top = Math.max(top, bounds.top);
            bottom = Math.min(bottom, bounds.bottom);
          }
        }
        return {
          paneWidth: pane.width,
          paneHeight: pane.height,
          visibleWidth: Math.min(code.right, right) - Math.max(code.left, left),
          visibleHeight: Math.min(code.bottom, bottom) - Math.max(code.top, top),
        };
      });
      expect(codeGeometry.paneWidth).toBeGreaterThan(0);
      expect(codeGeometry.paneHeight).toBeGreaterThan(0);
      expect(codeGeometry.visibleWidth).toBeGreaterThan(0);
      expect(codeGeometry.visibleHeight).toBeGreaterThan(0);
      await info.attach('reference-modified-code-geometry', {
        body: JSON.stringify(codeGeometry),
        contentType: 'application/json',
      });
      await capture(page, info, `reference-review-${theme}-${width}`);
      // A collapsed menu must not hide a range which changes what is being reviewed.
      await displaySummary.focus();
      await page.keyboard.press('Enter');
      await stagedCheckbox.check();
      await options.getByRole('combobox', { name: 'Diff 空白处理' }).click();
      await page.getByRole('option', { name: '忽略全部', exact: true }).click();
      await displaySummary.focus();
      await page.keyboard.press('Enter');
      await expect(displayDetails).not.toHaveAttribute('open', '');
      await expect(displaySummary).toContainText('已暂存');
      await expect(displaySummary).toContainText('忽略空白');
      await expect(displaySummary).toHaveAccessibleName('显示选项 · 已暂存 · 忽略全部空白');
      await expect(page.getByText('正在读取 Diff', { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await capture(page, info, `reference-review-filtered-${theme}-${width}`);
      expect(errors).toEqual([]);
      expect((await apiData<Id[]>(context, 'get', `/sessions/${session.id}/runs`)).length).toBe(1);
      expect(gitWrites).toEqual([]);
    });
  }
}
