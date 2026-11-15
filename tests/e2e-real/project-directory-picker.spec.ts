import type { Page, Locator, TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { test, expect, initializeGitProject } from './fixtures.js';
import { apiData } from './baseline-support.js';

test.use({ authMode: 'local_trusted' });

async function captureForm(page: Page, dialog: Locator, info: TestInfo, name: string) {
  await expect(dialog).toBeVisible();
  const scrollContainers = dialog.locator('*');
  const scrolls = await dialog.evaluate((root) =>
    [root, ...root.querySelectorAll('*')].flatMap((element, index) => {
      const style = getComputedStyle(element);
      if (!['auto', 'scroll'].includes(style.overflowY)) return [];
      element.scrollTop = 0;
      return [
        {
          index,
          className: element.className,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          scrollTop: element.scrollTop,
        },
      ];
    }),
  );
  await info.attach(`${name}-scroll`, {
    body: JSON.stringify(scrolls),
    contentType: 'application/json',
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
  for (const scroll of scrolls.filter((item) => item.scrollHeight > item.clientHeight + 1)) {
    const container = scroll.index === 0 ? dialog : scrollContainers.nth(scroll.index - 1);
    await container.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() =>
        container.evaluate((element) =>
          Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
        ),
      )
      .toBeLessThanOrEqual(1);
    const bottom = info.outputPath(`${name}-bottom-${scroll.index}.png`);
    await page.screenshot({ path: bottom, fullPage: true, animations: 'disabled' });
    await info.attach(`${name}-bottom-${scroll.index}`, { path: bottom, contentType: 'image/png' });
    await container.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect.poll(() => container.evaluate((element) => element.scrollTop)).toBe(0);
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 1024, 768, 390]) {
    test(`从授权父目录选择嵌套仓库并真实创建项目 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      const nestedRoot = join(app.projectRoot, 'nested-repo');
      await mkdir(nestedRoot);
      await initializeGitProject(nestedRoot);
      const target = await apiData<{ id: string }>(context, 'post', '/execution-targets', {
        name: '目录浏览环境',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      await page.goto('/projects/new');
      const dialog = page.getByRole('dialog', { name: '创建项目', exact: true });
      await expect(dialog.getByRole('textbox', { name: '项目名称', exact: true })).toHaveValue('');
      await expect(dialog.getByRole('button', { name: '预检并创建', exact: true })).toBeDisabled();
      await expect(page.getByRole('combobox', { name: '运行环境' })).toBeEnabled();
      await captureForm(page, dialog, testInfo, `project-create-empty-${width}-${theme}`);
      await page.getByRole('combobox', { name: '运行环境' }).click();
      await page.getByRole('option', { name: /目录浏览环境/ }).click();
      const discovered = dialog.getByRole('region', { name: '已发现项目', exact: true });
      const disclosure = discovered.locator('details');
      const toggle = disclosure.locator('summary');
      await expect(disclosure).not.toHaveAttribute('open', '');
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(43.99);
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toBeFocused();
      await expect(disclosure).toHaveAttribute('open', '');
      await expect(discovered.getByRole('button', { name: /nested-repo.*选择/ })).toBeVisible();
      await captureForm(page, dialog, testInfo, `project-discovered-open-${width}-${theme}`);
      await discovered.getByRole('button', { name: /nested-repo.*选择/ }).click();
      await expect(page.getByRole('textbox', { name: '项目名称' })).toHaveValue('nested-repo');
      const create = page.getByRole('button', { name: '预检并创建' });
      await expect(create).toBeEnabled();
      await expect(page.getByText('已选择的项目目录：', { exact: false })).toContainText(
        nestedRoot,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const nameField = dialog.getByRole('textbox', { name: '项目名称', exact: true });
      const descriptionField = dialog.getByRole('textbox', {
        name: '项目说明（可选）',
        exact: true,
      });
      await nameField.scrollIntoViewIfNeeded();
      const nameBox = (await nameField.boundingBox())!;
      const descriptionBox = (await descriptionField.boundingBox())!;
      const alignedPath = testInfo.outputPath(`project-fields-aligned-${width}-${theme}.png`);
      await page.screenshot({ path: alignedPath });
      await testInfo.attach('project-fields-aligned', {
        path: alignedPath,
        contentType: 'image/png',
      });
      await testInfo.attach('project-fields-aligned-geometry', {
        body: JSON.stringify({ nameBox, descriptionBox }),
        contentType: 'application/json',
      });
      if (width >= 768) expect(Math.abs(nameBox.y - descriptionBox.y)).toBeLessThanOrEqual(1);
      else expect(descriptionBox.y).toBeGreaterThan(nameBox.y + nameBox.height);
      await captureForm(page, dialog, testInfo, `nested-picker-${width}-${theme}`);
      await create.click();
      await expect(page).toHaveURL(/\/projects\/[^/]+\/overview$/);
      const projects = await apiData<Array<{ targetId: string; rootPath: string; name: string }>>(
        context,
        'get',
        '/projects',
      );
      expect(
        projects.some(
          (project) =>
            project.targetId === target.id &&
            project.rootPath === nestedRoot &&
            project.name === 'nested-repo',
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
