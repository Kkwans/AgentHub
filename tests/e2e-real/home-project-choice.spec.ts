import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`首页明确选择项目 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript((theme) => localStorage.setItem('agenthub-theme', theme), theme);
      const post = async (path: string, data?: Record<string, unknown>) => {
        const response = await context.request.post(`/api/v1${path}`, { data });
        expect(response.ok(), await response.text()).toBe(true);
        return (await response.json()).data as { id: string };
      };
      const target = await post('/execution-targets', {
        name: '项目选择宿主机',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const captureGuide = async (state: string) => {
        const guide = page.getByRole('region', { name: '准备第一个普通项目' });
        await expect(guide).toBeVisible();
        await expect(guide.getByRole('listitem')).toHaveCount(3);
        await expect(guide).toContainText('开始工作前仍会核验权限与执行环境');
        const create = page.getByRole('link', { name: '创建项目', exact: true });
        await expect(create).toHaveCount(1);
        await expect(create).toHaveAttribute('href', '/projects/new');
        const agent = guide.getByRole('link', { name: '查看 Agent 中心' });
        await expect(agent).toHaveAttribute('href', '/agents');
        const geometry = await guide.evaluate((node) => {
          const b = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const heading = document.querySelector('h1')!.getBoundingClientRect();
          return {
            height: b.height,
            left: b.left,
            headingLeft: heading.left,
            border: style.borderTopWidth,
          };
        });
        expect(geometry.border).toBe('0px');
        expect(Math.abs(geometry.left - geometry.headingLeft)).toBeLessThanOrEqual(1);
        if (width === 390) expect(geometry.height).toBeLessThan(360);
        expect((await agent.boundingBox())!.height).toBeGreaterThanOrEqual(43.99);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        const path = info.outputPath(`home-guide-${state}-${width}-${theme}.png`);
        await page.screenshot({ path, fullPage: true });
        await info.attach(`home-guide-${state}`, { path, contentType: 'image/png' });
        await info.attach(`home-guide-${state}-geometry`, {
          body: JSON.stringify(geometry),
          contentType: 'application/json',
        });
      };
      await page.goto('/home');
      await captureGuide('empty');
      const testRoot = join(app.projectRoot, 'test');
      await mkdir(testRoot, { recursive: true });
      const testProject = await post('/projects', {
        name: '同名正式项目：确认目录后再创建工作',
        kind: 'TEST',
        rootPath: testRoot,
        targetId: target.id,
      });
      await page.reload();
      await captureGuide('test-only');
      const testProjects = page.locator('details').filter({ hasText: '测试项目（1）' });
      await expect(testProjects).toBeVisible();
      await testProjects.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(
        testProjects.locator(`a[href="/projects/${testProject.id}/overview"]`),
      ).toBeVisible();
      const ids: string[] = [];
      for (const folder of ['one', 'two', 'test', 'archived']) {
        if (folder === 'test') {
          ids.push(testProject.id);
          continue;
        }
        const rootPath = join(app.projectRoot, folder);
        await mkdir(rootPath, { recursive: true });
        const project = await post('/projects', {
          name: '同名正式项目：确认目录后再创建工作',
          kind: folder === 'test' ? 'TEST' : 'STANDARD',
          rootPath,
          targetId: target.id,
        });
        ids.push(project.id);
        if (folder === 'archived') await post(`/projects/${project.id}/archive`);
      }
      await page.goto('/home');
      const trigger = page.getByRole('button', { name: '新建工作', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '选择工作所属项目' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: /同名正式项目/ })).toHaveCount(2);
      await expect(page).toHaveURL(/\/home$/);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const path = info.outputPath(`home-project-choice-${width}-${theme}.png`);
      await page.screenshot({ path });
      await info.attach('project-choice', { path, contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      const second = dialog.getByRole('button', { name: /\/two$/ });
      await second.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/projects/${ids[1]}/work/new$`));
      await expect(
        page
          .getByTestId('new-work-dialog')
          .getByText(join(app.projectRoot, 'two'), { exact: true }),
      ).toBeVisible();
      await page.goto('/home');
      await post(`/projects/${ids[1]}/archive`);
      await page.reload();
      await expect(page.getByRole('link', { name: '新建工作', exact: true })).toHaveAttribute(
        'href',
        `/projects/${ids[0]}/work/new`,
      );
      await expect(
        page.getByText('目标项目：同名正式项目：确认目录后再创建工作', { exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}
