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
