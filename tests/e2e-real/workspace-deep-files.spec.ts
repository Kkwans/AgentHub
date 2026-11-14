import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedWorkspace } from './baseline-support.js';
import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

// Disposable real filesystem and server; the only adapter is the local fake ACP.
// No provider prompt is sent and no production repository is touched.
const segments = [
  '源码 空间',
  '第二层#',
  'third & layer',
  '第四层',
  'fifth',
  'sixth',
  '第七层',
  'eighth',
  '最深目录',
];
const leaf = '唯一文件 # &.txt';
const marker = 'AGENTHUB_DEEP_TREE_REAL_9_LEVELS_中文_#_&';

for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`真实文件树逐层读取且不越界 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const { project, session } = await seedWorkspace(context, app);
      const deepest = join(app.projectRoot, ...segments);
      await mkdir(deepest, { recursive: true });
      await writeFile(join(deepest, leaf), marker + '\n');
      await mkdir(join(app.projectRoot, '未展开的兄弟目录'));
      await writeFile(join(app.projectRoot, '未展开的兄弟目录', '不可预加载.txt'), 'sibling');
      await mkdir(join(app.projectRoot, '空目录'));
      const outside = join(app.dataRoot, 'outside-tree-secret.txt');
      await writeFile(outside, 'OUTSIDE_CONTENT_MUST_NOT_BE_READ');
      await symlink(outside, join(app.projectRoot, '禁止外逃链接'));

      const reads: Array<{ path: string; depth: string | null }> = [];
      const contentReads: string[] = [];
      const writes: string[] = [];
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === `/api/v1/projects/${project.id}/files`) {
          reads.push({
            path: url.searchParams.get('path') ?? '',
            depth: url.searchParams.get('depth'),
          });
        }
        if (url.pathname === `/api/v1/projects/${project.id}/files/content`)
          contentReads.push(url.searchParams.get('path') ?? '');
        if (
          /\/api\/v1\/(?:sessions\/.*\/(?:messages|runs)|projects\/.*\/git\/)/.test(url.pathname) &&
          !['GET', 'HEAD'].includes(request.method())
        )
          writes.push(url.pathname);
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.goto(`/workspace/${session.id}?view=files`);
      const tree = page.locator('.file-tree');
      await expect(tree).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const blocked = tree.getByRole('button', { name: /^禁止外逃链接\s*已阻止$/ });
      await expect(blocked).toBeDisabled();
      await expect.poll(() => reads.length).toBeGreaterThan(0);
      expect(reads.every((read) => read.path === '' && read.depth === '0')).toBe(true);

      const touches = [];
      for (let i = 0; i < segments.length; i++) {
        const directory = tree.getByRole('button', { name: segments[i], exact: true });
        await expect(directory).toHaveAttribute('aria-expanded', 'false');
        await directory.scrollIntoViewIfNeeded();
        const box = (await directory.boundingBox())!;
        // Preserve compact 31px desktop rows; only phone directory targets are 44px.
        expect(box.height).toBeGreaterThanOrEqual(width === 390 ? 43.99 : 30.99);
        expect(box.width).toBeGreaterThanOrEqual(43.99);
        touches.push({ path: segments.slice(0, i + 1).join('/'), ...box });
        // Exercise the accessible native button rather than mutating component state.
        await directory.focus();
        await expect(directory).toBeFocused();
        expect(
          await tree.evaluate((node) => node.scrollWidth - node.clientWidth),
        ).toBeLessThanOrEqual(1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        const rows = await tree.locator('.file-node > button').evaluateAll((buttons) =>
          buttons
            .map((button) => button.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => ({ top: rect.top, bottom: rect.bottom })),
        );
        for (let row = 1; row < rows.length; row++) {
          expect(rows[row]!.top).toBeGreaterThanOrEqual(rows[row - 1]!.bottom - 1);
        }
        await page.keyboard.press('Enter');
        await expect(directory).toHaveAttribute('aria-expanded', 'true');
        const relative = segments.slice(0, i + 1).join('/');
        await expect
          .poll(() => reads.some((read) => read.path === relative && read.depth === '0'))
          .toBe(true);
        const next = i + 1 < segments.length ? segments[i + 1]! : leaf;
        await expect(tree.getByRole('button', { name: next, exact: true })).toBeVisible();
      }
      await tree.getByRole('button', { name: leaf, exact: true }).click();
      await expect(page.locator('.file-preview-editor .view-lines')).toContainText(marker, {
        timeout: 30_000,
      });
      await expect(page.locator('.file-preview-header')).toContainText(leaf);
      await expect.poll(() => contentReads.includes([...segments, leaf].join('/'))).toBe(true);
      const capture = async (name: string) => {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        expect(
          await tree.evaluate((node) => node.scrollWidth - node.clientWidth),
        ).toBeLessThanOrEqual(1);
        const path = info.outputPath(`${name}-${width}-${theme}.png`);
        await page.screenshot({ path });
        await info.attach(name, { path, contentType: 'image/png' });
      };
      await capture('deep-file-reading');
      const empty = tree.getByRole('button', { name: '空目录', exact: true });
      await empty.scrollIntoViewIfNeeded();
      await empty.click();
      await expect
        .poll(() => reads.some((read) => read.path === '空目录' && read.depth === '0'))
        .toBe(true);
      await expect(
        empty
          .locator('..')
          .locator('p')
          .filter({ hasText: /^空目录$/ }),
      ).toBeVisible();
      await capture('deep-file-empty-directory');
      const allowed = new Set([
        '',
        '空目录',
        ...segments.map((_, index) => segments.slice(0, index + 1).join('/')),
      ]);
      expect(reads.every((read) => read.depth === '0' && allowed.has(read.path))).toBe(true);
      expect(
        reads.some(
          (read) => read.path.includes('未展开的兄弟目录') || read.path.includes('禁止外逃链接'),
        ),
      ).toBe(false);
      expect(contentReads).not.toContain('禁止外逃链接');
      await expect(page.getByText('OUTSIDE_CONTENT_MUST_NOT_BE_READ', { exact: true })).toHaveCount(
        0,
      );
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach('deep-file-request-and-touch-evidence', {
        body: JSON.stringify({ reads, contentReads, touches, writes, errors }),
        contentType: 'application/json',
      });
    });
  }
}
