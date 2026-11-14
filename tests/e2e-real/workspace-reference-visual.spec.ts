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
            const summaryBox = (await summary.boundingBox())!;
            const titleBox = (await card.locator('.tool-entry-badge').boundingBox())!;
            expect(summaryBox.width).toBeGreaterThan(0);
            expect(summaryBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
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
      }
      await showChanges(page, width);
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

      const options = review.getByRole('group', { name: '文件 Diff 显示选项' });
      await expect(options).toHaveCount(1);
      await expect(review.locator(':scope > .git-diff-toolbar')).toHaveCount(0);
      await expect(review.locator('.git-selected-diff-heading code')).toHaveText('runner.ts');
      // `has` locators are evaluated from each candidate, not from the page.
      // Keep the label scoped once, then verify its actual named checkbox.
      const stagedToggle = options.locator('label.git-diff-toggle');
      await expect(stagedToggle).toHaveCount(1);
      const stagedCheckbox = stagedToggle.getByRole('checkbox', { name: 'staged', exact: true });
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
      expect(surfaceGeometry.controls).toBe(1);
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
      expect(errors).toEqual([]);
      expect((await apiData<Id[]>(context, 'get', `/sessions/${session.id}/runs`)).length).toBe(1);
      expect(gitWrites).toEqual([]);
    });
  }
}
