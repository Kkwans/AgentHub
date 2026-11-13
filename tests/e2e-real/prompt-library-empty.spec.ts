import { apiData, seedWorkspace } from './baseline-support.js';
import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
const promptName = '跨项目代码审查与风险复核的正式模板：保留全部上下文并逐项确认执行结果';
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`Prompt 空库到内容与筛选 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const errors: string[] = [];
      let injectingTargetFailure = false;
      let bindingWrites = 0;
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/v1/prompt-bindings'
        )
          bindingWrites += 1;
      });
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          !(
            injectingTargetFailure &&
            message.location().url.endsWith('/api/v1/agents') &&
            message.text().includes('503')
          )
        )
          errors.push(message.text());
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      const capture = async (state: string) => {
        // The Prompt grid must not distribute spare viewport height into its
        // header. Compare intrinsic content, not a fixed height: wrapping and
        // the non-empty state's create action legitimately make it taller.
        const headerGeometry = await page.locator('.navigation-page-header').evaluate((outer) => {
          const inner = outer.querySelector('.page-header-row');
          if (!inner) throw new Error('Prompt page header content is missing');
          const container = outer.getBoundingClientRect();
          const content = inner.getBoundingClientRect();
          return { containerHeight: container.height, contentHeight: content.height };
        });
        expect(headerGeometry.contentHeight).toBeGreaterThan(0);
        expect(
          headerGeometry.containerHeight - headerGeometry.contentHeight,
        ).toBeGreaterThanOrEqual(0);
        expect(headerGeometry.containerHeight - headerGeometry.contentHeight).toBeLessThanOrEqual(
          2,
        );
        await info.attach(`header-geometry-${state}`, {
          body: JSON.stringify(headerGeometry),
          contentType: 'application/json',
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        const path = info.outputPath(`prompt-library-${state}-${width}-${theme}.png`);
        await page.screenshot({ path, fullPage: true });
        await info.attach(state, { path, contentType: 'image/png' });
      };
      await page.goto('/prompts');
      await expect(page.getByText('还没有 Prompt', { exact: true })).toBeVisible();
      const create = page.getByRole('button', { name: '新建 Prompt', exact: true });
      await expect(create).toHaveCount(1);
      await expect(create).toBeInViewport();
      await expect(page.getByRole('complementary', { name: 'Prompt 目录' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Prompt 编辑器' })).toHaveCount(0);
      await capture('empty');
      await create.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '新建 Prompt' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(create).toBeFocused();
      const emptyResponse = await context.request.get('/api/v1/prompts');
      expect(emptyResponse.ok()).toBe(true);
      expect((await emptyResponse.json()).data).toEqual([]);
      await create.click();
      await dialog.getByRole('textbox', { name: '名称', exact: true }).fill(promptName);
      await dialog
        .getByRole('textbox', { name: 'Key', exact: true })
        .fill('visual/empty-to-content');
      await dialog.getByRole('button', { name: '创建', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const editor = page.getByRole('region', { name: 'Prompt 编辑器' });
      await expect(editor.getByRole('heading', { name: promptName })).toBeVisible();
      await capture('content');
      await expect(editor.getByText('9 字符', { exact: true })).toHaveCount(0);
      await editor.getByRole('button', { name: '创建第一个版本', exact: true }).click();
      const versionDialog = page.getByRole('dialog', { name: '创建新版本', exact: true });
      const bodyInput = versionDialog.getByRole('textbox', { name: 'Prompt 内容', exact: true });
      await expect(bodyInput).toHaveValue('');
      await expect(
        versionDialog.getByRole('button', { name: '创建版本', exact: true }),
      ).toBeDisabled();
      await expect(versionDialog).not.toHaveClass(/ah-dialog-fullscreen/);
      if (width === 390) {
        const bounds = await versionDialog.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThan(0);
        expect(bounds!.width).toBeLessThan(width);
      }
      await capture('first-version-dialog');
      await versionDialog.getByRole('button', { name: '取消', exact: true }).click();
      await editor.getByRole('button', { name: '创建第一个版本', exact: true }).click();
      const actualBody = '只使用用户编写的真实正文，不包含资产说明或界面占位提示。';
      await bodyInput.fill(actualBody);
      await versionDialog.getByRole('button', { name: '创建版本', exact: true }).click();
      await expect(versionDialog).not.toBeVisible();
      await expect(editor.getByText(actualBody, { exact: true })).toBeVisible();
      const assetsResponse = await context.request.get('/api/v1/prompts');
      expect(assetsResponse.ok()).toBe(true);
      const assets = (await assetsResponse.json()).data as { id: string; key: string }[];
      const created = assets.find((asset) => asset.key === 'visual/empty-to-content');
      expect(created).toBeDefined();
      const versionsResponse = await context.request.get(`/api/v1/prompts/${created!.id}/versions`);
      expect(versionsResponse.ok()).toBe(true);
      const versions = (await versionsResponse.json()).data;
      expect(versions).toHaveLength(1);
      expect(versions[0].contentJson).toEqual({ text: actualBody });
      await editor.getByText(actualBody, { exact: true }).scrollIntoViewIfNeeded();
      await expect(editor.getByText(actualBody, { exact: true })).toBeInViewport({ ratio: 1 });
      await capture('first-version-saved');

      // The asset-creation dialog has no Select. Exercise the real binding dialog,
      // which uses the same FormDialog and a labelled, portaled Radix Select.
      await editor.getByRole('tab', { name: '绑定', exact: true }).click();
      const bindingTrigger = editor.getByRole('button', { name: '新增绑定', exact: true });
      await bindingTrigger.click();
      const bindingDialog = page.getByRole('dialog', { name: '新建 Prompt 绑定', exact: true });
      await expect(bindingDialog).toBeVisible();
      const targetType = bindingDialog.getByRole('combobox', { name: '绑定目标类型', exact: true });
      await expect(targetType).toHaveText('Project');
      await targetType.click();
      const agentOption = page.getByRole('option', { name: 'Agent', exact: true });
      await expect(agentOption).toBeVisible();
      // Visibility alone does not detect a menu painted behind the modal backdrop.
      // Check the actual hit target, then use an ordinary (never forced) pointer click.
      await expect
        .poll(() =>
          agentOption.evaluate((option) => {
            const rect = option.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return hit !== null && option.contains(hit);
          }),
        )
        .toBe(true);
      await capture('binding-select-open');
      await agentOption.click();
      await expect(targetType).toHaveText('Agent');
      await expect(bindingDialog.getByRole('status', { name: '绑定目标读取状态' })).toContainText(
        '当前没有可绑定的 Agent',
      );
      await expect(
        bindingDialog.getByRole('button', { name: '创建绑定', exact: true }),
      ).toBeDisabled();
      await capture('binding-target-empty');
      injectingTargetFailure = true;
      await page.route('**/api/v1/agents', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '目标读取暂时失败' } }),
        });
      });
      await bindingDialog.getByRole('button', { name: '重新读取目标' }).click();
      const targetError = bindingDialog.getByRole('alert', { name: '绑定目标读取状态' });
      await expect(targetError).toContainText('目标读取失败');
      await expect(targetError).not.toContainText('原选择已保留');
      await expect(
        bindingDialog.getByRole('button', { name: '创建绑定', exact: true }),
      ).toBeDisabled();
      await capture('binding-target-error');
      await page.unroute('**/api/v1/agents');
      injectingTargetFailure = false;
      await bindingDialog.getByRole('button', { name: '重新读取目标' }).click();
      await expect(targetError).toHaveCount(0);
      await expect(bindingDialog.getByRole('status', { name: '绑定目标读取状态' })).toContainText(
        '当前没有可绑定的 Agent',
      );

      await expect(page.getByRole('listbox')).toHaveCount(0);
      await targetType.click();
      await expect(page.getByRole('option', { name: 'Project', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(bindingDialog).toBeVisible();
      await expect(targetType).toBeFocused();
      // Both boundary directions must loop within the modal, not reach the shell.
      const closeBinding = bindingDialog.getByRole('button', { name: '关闭', exact: true });
      const cancelBinding = bindingDialog.getByRole('button', { name: '取消', exact: true });
      await cancelBinding.focus();
      await page.keyboard.press('Tab');
      await expect(closeBinding).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(cancelBinding).toBeFocused();
      expect(bindingWrites).toBe(0);
      await capture('binding-dialog-keyboard');
      await page.keyboard.press('Escape');
      await expect(bindingDialog).not.toBeVisible();
      await expect(bindingTrigger).toBeFocused();
      // Reopen through the real trigger immediately after dismissal. Delayed
      // restoration from the old instance must not steal the new modal's focus.
      await bindingTrigger.click();
      await bindingDialog.getByRole('button', { name: '关闭', exact: true }).click();
      await bindingTrigger.click();
      await expect(bindingDialog).toBeVisible();
      await expect
        .poll(() => bindingDialog.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
      await page.keyboard.press('Tab');
      await expect
        .poll(() => bindingDialog.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
      await page.keyboard.press('Escape');
      await expect(bindingDialog).not.toBeVisible();
      await expect(bindingTrigger).toBeFocused();
      await editor.getByRole('tab', { name: '内容', exact: true }).click();
      if (width === 390) {
        const toggle = page.getByRole('button', { name: '展开目录', exact: true });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
      }
      const search = page.getByRole('textbox', { name: '搜索 Prompt' });
      await search.fill('完全不匹配的关键词');
      await expect(page.getByText('没有匹配的 Prompt', { exact: true })).toBeVisible();
      await expect(editor.getByRole('heading', { name: promptName })).toBeVisible();
      await expect(page.getByText('还没有 Prompt', { exact: true })).toHaveCount(0);
      await capture('filtered');
      await search.fill('');
      await expect(
        page
          .getByRole('complementary', { name: 'Prompt 目录' })
          .getByRole('button', { name: promptName }),
      ).toBeVisible();
      await page.goto('/home');
      await page.goBack();
      await expect(editor.getByRole('heading', { name: promptName })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

// Separate from the eight empty/error cases: all three writes below go through
// the real UI and isolated loopback service, never a fulfilled success fixture.
test('Prompt 显式选择三类目标并保存真实绑定 390 light', async ({ page, context, app }, info) => {
  const errors: string[] = [];
  const writes: Array<Record<string, unknown>> = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/prompt-bindings'
    )
      writes.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.addInitScript((origin) => {
    if (location.origin === origin) localStorage.setItem('agenthub-theme', 'light');
  }, app.origin);
  const { project, agent } = await seedWorkspace(context, app);
  const task = await apiData<{ id: string }>(context, 'post', '/tasks', {
    projectId: project.id,
    title: '绑定正向验证工作',
  });
  const prompt = await apiData<{ id: string }>(context, 'post', '/prompts', {
    projectId: project.id,
    key: 'e2e/binding-positive',
    name: '真实绑定验证模板',
    kind: 'TASK',
    type: 'TEXT',
  });
  const version = await apiData<{ id: string }>(context, 'post', `/prompts/${prompt.id}/versions`, {
    content: { text: '只绑定显式选择的真实目标。' },
  });
  await page.goto('/prompts');
  const editor = page.getByRole('region', { name: 'Prompt 编辑器' });
  await expect(editor.getByRole('heading', { name: '真实绑定验证模板' })).toBeVisible();
  await editor.getByRole('tab', { name: '绑定', exact: true }).click();
  const targets = [
    { type: 'PROJECT', label: 'Project', id: project.id, name: 'v1 baseline project' },
    { type: 'AGENT', label: 'Agent', id: agent.id, name: 'v1 baseline agent' },
    { type: 'TASK', label: 'Task', id: task.id, name: '绑定正向验证工作' },
  ];
  for (const [index, target] of targets.entries()) {
    await editor.getByRole('button', { name: '新增绑定', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建 Prompt 绑定', exact: true });
    const targetType = dialog.getByRole('combobox', { name: '绑定目标类型', exact: true });
    if ((await targetType.innerText()) !== target.label) {
      await targetType.click();
      await page.getByRole('option', { name: target.label, exact: true }).click();
    }
    const submit = dialog.getByRole('button', { name: '创建绑定', exact: true });
    await expect(submit).toBeDisabled();
    const targetSelect = dialog.getByRole('combobox', { name: target.label, exact: true });
    await expect(targetSelect).toHaveText('请选择绑定目标');
    await targetSelect.click();
    await page.getByRole('option', { name: target.name, exact: true }).click();
    const selector = dialog.getByRole('combobox', { name: '选择方式', exact: true });
    if ((await selector.innerText()) !== '固定版本') {
      await selector.click();
      await page.getByRole('option', { name: '固定版本', exact: true }).click();
    }
    await dialog.getByRole('combobox', { name: '固定版本', exact: true }).click();
    await page.getByRole('option', { name: /^v1 ·/ }).click();
    await expect(targetSelect).toHaveText(target.name);
    await expect(dialog.getByRole('combobox', { name: '固定版本', exact: true })).toHaveText(
      /^v1 ·/,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await expect(submit).toBeEnabled();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/prompt-bindings',
    );
    await submit.click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBe(true);
    const saved = (await response.json()).data as { id: string };
    const expected = {
      targetType: target.type,
      targetId: target.id,
      promptId: prompt.id,
      selectorType: 'VERSION',
      versionId: version.id,
      slot: 'SYSTEM',
      priority: 0,
    };
    expect(saved).toMatchObject({ ...expected, enabled: true });
    expect(writes).toHaveLength(index + 1);
    expect(writes[index]).toEqual(expected);
    await expect(dialog).not.toBeVisible();
    await expect(editor.getByText(target.name, { exact: true })).toBeVisible();
    const persisted = await apiData<Array<{ id: string }>>(
      context,
      'get',
      `/prompt-bindings?targetType=${target.type}&targetId=${target.id}`,
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ ...expected, id: saved.id, enabled: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const path = info.outputPath(`binding-saved-${target.type.toLowerCase()}-390-light.png`);
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    await info.attach(`binding-saved-${target.type}`, { path, contentType: 'image/png' });
  }
  const all = await apiData<unknown[]>(context, 'get', `/prompt-bindings?promptId=${prompt.id}`);
  expect(all).toHaveLength(3);
  expect(writes).toHaveLength(3);
  expect(errors).toEqual([]);
});

// Delay delivery of a genuine committed response, not the server write itself.
test('Prompt 绑定晚成功不关闭重开的草稿 390 light', async ({ page, context, app }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.addInitScript((origin) => {
    if (location.origin === origin) localStorage.setItem('agenthub-theme', 'light');
  }, app.origin);
  const { project } = await seedWorkspace(context, app);
  const prompt = await apiData<{ id: string }>(context, 'post', '/prompts', {
    projectId: project.id,
    key: 'e2e/binding-delayed',
    name: '原绑定请求模板',
    kind: 'TASK',
    type: 'TEXT',
  });
  const version = await apiData<{ id: string }>(context, 'post', `/prompts/${prompt.id}/versions`, {
    content: { text: '旧请求不得关闭新草稿。' },
  });
  const errors: string[] = [];
  const writes: unknown[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/prompt-bindings'
    )
      writes.push(request.postDataJSON());
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let started = false;
  let fetched = false;
  let handlerError: unknown;
  let savedId: string | undefined;
  const expected = {
    targetType: 'PROJECT',
    targetId: project.id,
    promptId: prompt.id,
    slot: 'SYSTEM',
    selectorType: 'VERSION',
    versionId: version.id,
    priority: 0,
  };
  const url = `${app.origin}/api/v1/prompt-bindings`;
  await page.route(url, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    started = true;
    try {
      const response = await route.fetch({ timeout: 15_000 });
      expect(response.ok()).toBe(true);
      const saved = (await response.json()).data;
      expect(saved).toMatchObject({ ...expected, enabled: true });
      expect(typeof saved.id).toBe('string');
      savedId = saved.id;
      fetched = true;
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      handlerError = error;
      fetched = true;
      await route.abort().catch(() => {});
    } finally {
      finish();
    }
  });
  try {
    await page.goto('/prompts');
    const editor = page.getByRole('region', { name: 'Prompt 编辑器' });
    await expect(editor.getByRole('heading', { name: '原绑定请求模板' })).toBeVisible();
    await editor.getByRole('tab', { name: '绑定', exact: true }).click();
    await editor.getByRole('button', { name: '新增绑定', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建 Prompt 绑定', exact: true });
    await dialog.getByRole('combobox', { name: 'Project', exact: true }).click();
    await page.getByRole('option', { name: 'v1 baseline project', exact: true }).click();
    await dialog.getByRole('combobox', { name: '选择方式', exact: true }).click();
    await page.getByRole('option', { name: '固定版本', exact: true }).click();
    await dialog.getByRole('combobox', { name: '固定版本', exact: true }).click();
    await page.getByRole('option', { name: /^v1 ·/ }).click();
    await dialog.getByRole('button', { name: '创建绑定', exact: true }).click();
    await expect.poll(() => fetched, { timeout: 20_000 }).toBe(true);
    if (handlerError) throw handlerError;
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await editor.getByRole('button', { name: '新增绑定', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '创建绑定', exact: true })).toBeDisabled();
    await dialog.getByRole('combobox', { name: '提示位', exact: true }).click();
    await page.getByRole('option', { name: '任务前置', exact: true }).click();
    release();
    await done;
    if (handlerError) throw handlerError;
    // Waiting for the pending lock to clear proves the callback has run.
    await expect(dialog.getByRole('button', { name: '创建绑定', exact: true })).toBeEnabled();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: '提示位', exact: true })).toHaveText(
      '任务前置',
    );
    expect(writes).toEqual([expected]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const draftPath = info.outputPath('binding-delayed-new-draft-390-light.png');
    await page.screenshot({ path: draftPath, fullPage: true, animations: 'disabled' });
    await info.attach('旧响应后保留的新草稿', { path: draftPath, contentType: 'image/png' });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    const result = page.getByRole('status', { name: '绑定操作结果' });
    await expect(result).toContainText('已保存原绑定');
    await expect(result).toContainText(prompt.id);
    await expect(result).toContainText(savedId!);
    const persisted = await apiData<Array<{ id: string }>>(
      context,
      'get',
      `/prompt-bindings?promptId=${prompt.id}`,
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ ...expected, id: savedId, enabled: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const path = info.outputPath('binding-delayed-original-result-390-light.png');
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    await info.attach('原绑定晚成功结果', { path, contentType: 'image/png' });
    expect(errors).toEqual([]);
  } finally {
    release();
    if (started) await done;
    await page.unroute(url);
  }
});
