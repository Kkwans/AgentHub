import { apiData } from './baseline-support.js';
import { expect, initializeGitProject, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`项目工作真空态到任务创建与筛选 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
      await initializeGitProject(app.projectRoot);
      const target = await apiData<{ id: string }>(context, 'post', '/execution-targets', {
        name: '工作空态环境',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const project = await apiData<{ id: string }>(context, 'post', '/projects', {
        name: '当前工作项目',
        targetId: target.id,
        rootPath: app.projectRoot,
        kind: 'STANDARD',
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript(
        ({ origin, theme }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { origin: app.origin, theme },
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const capture = async (state: string) => {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        const path = info.outputPath(`project-work-${state}-${width}-${theme}.png`);
        await page.screenshot({ path, fullPage: true });
        await info.attach(state, { path, contentType: 'image/png' });
      };
      await page.goto(`/projects/${project.id}/work`);
      await expect(page.getByRole('heading', { name: '开始这个项目的第一项工作' })).toBeVisible();
      const create = page.getByRole('link', { name: '新建工作', exact: true });
      await expect(create).toHaveCount(1);
      await expect(create).toHaveAttribute('href', `/projects/${project.id}/work/new`);
      // No scrollIntoView before this assertion: the sole CTA must be reachable on arrival.
      await expect(create).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('textbox', { name: '搜索工作' })).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: '工作 Inspector' })).toHaveCount(0);
      await capture('empty');
      await create.click();
      await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/work/new$`));
      const dialog = page.getByRole('dialog', { name: '描述一项工作' });
      await dialog
        .getByRole('textbox', { name: '你想完成什么？' })
        .fill('完成当前项目的第一项工作');
      await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const tasks = await apiData<Array<{ id: string; projectId: string }>>(
        context,
        'get',
        `/tasks?projectId=${project.id}`,
      );
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.projectId).toBe(project.id);
      const inspector = page.getByRole('complementary', { name: '工作 Inspector' });
      await expect(inspector).toContainText('完成当前项目的第一项工作');
      const search = page.getByRole('textbox', { name: '搜索工作' });
      await expect(search).toBeVisible();
      await capture('created');
      await search.fill('无匹配结果关键词');
      await expect(page.getByText('没有匹配的工作', { exact: true })).toBeVisible();
      await expect(inspector).toContainText('完成当前项目的第一项工作');
      await expect(page.getByText('开始这个项目的第一项工作', { exact: true })).toHaveCount(0);
      await capture('filtered');
      await search.fill('');
      await page.getByRole('button', { name: '看板', exact: true }).click();
      await expect(page.getByLabel('工作看板')).toContainText('完成当前项目的第一项工作');
      await page.getByRole('button', { name: '列表', exact: true }).click();
      await expect(inspector).toContainText('完成当前项目的第一项工作');
      expect(await apiData(context, 'get', `/sessions?projectId=${project.id}`)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
