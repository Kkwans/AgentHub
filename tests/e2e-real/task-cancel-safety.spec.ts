import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
test('进行中任务不能假取消，四宽双主题提供原工作区停止入口', async ({
  page,
  context,
  app,
}, info) => {
  const { project, agent } = await seedWorkspace(context, app);
  const task = await apiData<{ id: string }>(context, 'post', '/tasks', {
    projectId: project.id,
    title: '等待授权的真实 Fixture 任务',
  });
  await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
  const started = await apiData<{ session: { id: string }; run: { id: string } }>(
    context,
    'post',
    `/tasks/${task.id}/start`,
    { agentId: agent.id },
  );
  // Fixture ACP waits for explicit approval; this is not a real provider or NAS.
  await expect
    .poll(async () => {
      const runs = await apiData<Array<{ id: string; status: string }>>(
        context,
        'get',
        `/sessions/${started.session.id}/runs`,
      );
      return runs.find((run) => run.id === started.run.id)?.status;
    })
    .toBe('WAITING_APPROVAL');
  for (const status of ['CANCELED', 'BLOCKED', 'WAITING_REVIEW']) {
    const response = await context.request.post(`/api/v1/tasks/${task.id}/transition`, {
      data: { status },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe('TASK_RUN_CANCEL_REQUIRED');
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/projects/${project.id}/work?task=${task.id}`);
      await page.evaluate((value) => localStorage.setItem('agenthub-theme', value), theme);
      await page.reload();
      const stop = page.getByRole('button', { name: '前往工作区停止执行', exact: true });
      await expect(stop).toBeVisible();
      await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
      await expect(page.getByText(/停止请求不代表已停止/)).toBeVisible();
      await stop.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`task-cancel-${width}-${theme}.png`),
        fullPage: true,
      });
      await stop.click();
      await expect(page).toHaveURL(new RegExp(`/workspace/${started.session.id}$`));
      expect((await apiData<{ status: string }>(context, 'get', `/tasks/${task.id}`)).status).toBe(
        'IN_PROGRESS',
      );
    }
  }
  expect(errors).toEqual([]);
});
