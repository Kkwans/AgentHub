import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { test, expect, initializeGitProject } from './fixtures.js';
import { apiData } from './baseline-support.js';

test.use({ authMode: 'local_trusted' });

for (const width of [1440, 1024, 768, 390]) {
  test(`从授权父目录选择嵌套仓库并真实创建项目 ${width}`, async ({
    page,
    context,
    app,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width, height: 1000 });
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
    await page.getByRole('combobox', { name: '运行环境' }).click();
    await page.getByRole('option', { name: /目录浏览环境/ }).click();
    await page.getByRole('button', { name: /nested-repo.*选择/ }).click();
    await expect(page.getByRole('textbox', { name: '项目名称' })).toHaveValue('nested-repo');
    const create = page.getByRole('button', { name: '预检并创建' });
    await expect(create).toBeEnabled();
    await expect(page.getByText('已选择的项目目录：', { exact: false })).toContainText(nestedRoot);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`nested-picker-${width}.png`),
      fullPage: true,
    });
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
