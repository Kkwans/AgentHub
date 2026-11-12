import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

async function post<T>(context: BrowserContext, path: string, data?: Record<string, unknown>) {
  const response = await context.request.post(`/api/v1${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return ((await response.json()) as { data: T }).data;
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`真实项目筛选 ${width} ${theme}`, async ({ page, context, app }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (window.location.origin === origin)
            window.localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      const target = await post<{ id: string }>(context, '/execution-targets', {
        name: '项目筛选测试宿主机',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      for (const [name, kind, folder] of [
        ['正式筛选项目', 'STANDARD', 'standard'],
        ['归档测试项目', 'TEST', 'test'],
      ] as const) {
        const rootPath = join(app.projectRoot, folder);
        await mkdir(rootPath, { recursive: true });
        const project = await post<{ id: string }>(context, '/projects', {
          name,
          kind,
          rootPath,
          targetId: target.id,
        });
        if (kind === 'TEST') await post(context, `/projects/${project.id}/archive`);
      }
      await page.goto('/projects');
      await expect(page.getByText('2 个项目', { exact: true })).toBeVisible();
      await expect(
        page.locator('details').filter({ hasText: '测试 Project（1）' }),
      ).not.toHaveAttribute('open');
      const toggle = page.getByRole('button', { name: /筛选和排序/ });
      if (width === 390) {
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toHaveAttribute('aria-controls', 'project-filter-options');
        await expect(page.getByRole('combobox', { name: '项目状态' })).toBeHidden();
        await capture(page, testInfo, 'projects-initial-compact');
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      } else {
        await expect(toggle).toHaveCount(0);
        await expect(page.getByRole('combobox', { name: '项目状态' })).toBeVisible();
        await capture(page, testInfo, 'projects-initial-desktop');
      }
      await select(page, '项目状态', '已归档');
      await select(page, '项目排序', '名称 A-Z');
      await expect(page.getByText('1 个项目', { exact: true })).toBeVisible();
      if (width === 390) {
        await toggle.click();
        await expect(toggle).toHaveText('筛选和排序2');
        await expect(page.getByRole('combobox', { name: '项目状态' })).toBeHidden();
        await page.setViewportSize({ width: 1024, height: 900 });
        await expect(toggle).toHaveCount(0);
        await expect(page.getByRole('combobox', { name: '项目状态' })).toHaveText('已归档');
        await expect(page.getByRole('combobox', { name: '项目排序' })).toHaveText('名称 A-Z');
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toHaveText('筛选和排序2');
        await expect(page.getByText('1 个项目', { exact: true })).toBeVisible();
      }
      // Changing view exposes the matching test project without conflating it with standard projects.
      await page.getByRole('button', { name: '卡片', exact: true }).click();
      await expect(page.getByRole('link', { name: /归档测试项目/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /正式筛选项目/ })).toHaveCount(0);
      await capture(page, testInfo, 'projects-filtered');
      await page.getByRole('button', { name: /清除条件/ }).click();
      await expect(page.getByText('2 个项目', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '卡片', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('link', { name: /正式筛选项目/ })).toBeVisible();
      if (width === 390) await toggle.click();
      await expect(page.getByRole('combobox', { name: '项目状态' })).toHaveText('全部状态');
      await expect(page.getByRole('combobox', { name: '项目排序' })).toHaveText('最新更新');
      await capture(page, testInfo, 'projects-cleared');
      expect(errors).toEqual([]);
    });
  }
}
