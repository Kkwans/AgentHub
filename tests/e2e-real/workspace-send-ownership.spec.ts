import type { Page } from '@playwright/test';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

async function selectSession(page: Page, id: string) {
  const link = page.locator(`.session-rail a[href="/workspace/${id}"]`);
  // Mobile drawers do not mount the rail until opened; desktop list loading
  // must not be mistaken for a collapsed drawer with a nonexistent toggle.
  if ((page.viewportSize()?.width ?? 1440) < 1180 && !(await link.isVisible())) {
    const open = page.getByRole('button', { name: '打开辅助栏', exact: true });
    if (await open.isVisible()) await open.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${id}$`));
}

for (const width of [390, 768, 1024, 1440]) {
  test(`真实发送晚回包不清空缓存会话草稿 ${width}`, async ({ page, context, app }, info) => {
    const { project, agent, session: first } = await seedWorkspace(context, app);
    const second = await apiData<{ id: string }>(context, 'post', '/sessions', {
      projectId: project.id,
      agentId: agent.id,
      title: '保留草稿的第二会话',
      cwd: app.projectRoot,
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let actualRun: { id: string } | undefined;
    let firstPosts = 0;
    let secondPosts = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === `/api/v1/sessions/${second.id}/runs`
      )
        secondPosts += 1;
    });
    await context.route(`${app.origin}/api/v1/sessions/${first.id}/runs`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      firstPosts += 1;
      // Execute the genuine server/ACP request; only delay delivery to the browser.
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.ok()).toBe(true);
      actualRun = (await response.json()).data;
      await held;
      await route.fulfill({ response });
    });
    try {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`/workspace/${second.id}`);
      const input = page.getByRole('textbox', { name: '给 Agent 发送工程指令' });
      const send = page.getByRole('button', { name: '发送', exact: true });
      const originalDraft = '第二会话尚未发送的重要草稿';
      const editedDraft = `${originalDraft}，切回后继续补充`;
      await input.fill(originalDraft);
      await expect(send).toBeEnabled();
      await expect
        .poll(() =>
          page.evaluate(
            (id) => sessionStorage.getItem(`agenthub.workspace.composer.${id}`),
            second.id,
          ),
        )
        .toBe(originalDraft);
      // React Router navigation is deliberate: a reload would discard QueryClient
      // cache and mask the same-mounted-Composer ownership regression.
      await selectSession(page, first.id);
      await input.fill('第一会话真实运行，仅延迟 HTTP 成功响应');
      await expect(send).toBeEnabled();
      await send.click();
      await expect.poll(() => actualRun?.id).toBeTruthy();
      await selectSession(page, second.id);
      await expect(input).toHaveValue(originalDraft);
      await expect(input).toBeEditable();
      await expect(send).toBeEnabled();
      await input.fill(editedDraft);
      const delivered = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/api/v1/sessions/${first.id}/runs`,
      );
      release();
      await (await delivered).finished();
      // Complete the real ACP turn, allowing both response callbacks and live
      // event invalidations to settle before checking the other Session again.
      let approvalId: string | undefined;
      await expect
        .poll(
          async () => {
            const approvals = await apiData<Array<{ id: string; runId: string; status: string }>>(
              context,
              'get',
              `/approvals?sessionId=${first.id}`,
            );
            approvalId = approvals.find(
              (item) => item.runId === actualRun!.id && item.status === 'PENDING',
            )?.id;
            return approvalId;
          },
          { timeout: 15_000 },
        )
        .toBeTruthy();
      await apiData(context, 'post', `/approvals/${approvalId!}/resolve`, {
        optionId: 'allow-once',
      });
      await expect
        .poll(
          async () =>
            (
              await apiData<Array<{ id: string; status: string }>>(
                context,
                'get',
                `/sessions/${first.id}/runs`,
              )
            ).find((run) => run.id === actualRun!.id)?.status,
          { timeout: 15_000 },
        )
        .toBe('COMPLETED');
      await expect(page).toHaveURL(new RegExp(`/workspace/${second.id}$`));
      await expect(input).toHaveValue(editedDraft);
      await expect(send).toBeEnabled();
      expect(
        await page.evaluate(
          (id) => sessionStorage.getItem(`agenthub.workspace.composer.${id}`),
          second.id,
        ),
      ).toBe(editedDraft);
      expect(await apiData<unknown[]>(context, 'get', `/sessions/${second.id}/runs`)).toHaveLength(
        0,
      );
      expect(await apiData<unknown[]>(context, 'get', `/sessions/${first.id}/runs`)).toHaveLength(
        1,
      );
      expect(firstPosts).toBe(1);
      expect(secondPosts).toBe(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const screenshot = info.outputPath(`workspace-send-ownership-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await info.attach('旧发送完成后第二会话草稿保留', {
        path: screenshot,
        contentType: 'image/png',
      });
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}
