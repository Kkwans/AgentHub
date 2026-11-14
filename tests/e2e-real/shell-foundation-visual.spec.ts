import type { Locator, Page, TestInfo } from '@playwright/test';
import { seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
// Real isolated service/PGlite and controlled fake ACP only. Geometry is a
// regression gate, not proof of attractive design or real provider support.
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function touchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(43.99);
  expect(box!.height).toBeGreaterThanOrEqual(43.99);
}
async function brandGeometry(link: Locator, info: TestInfo, name: string, collapsed = false) {
  await expect(link).toBeVisible();
  if (!collapsed) {
    await expect(link.locator('.agenthub-logo')).toHaveCount(0);
    const wordmark = link.locator('[data-brand-wordmark="true"]');
    await expect(wordmark).toHaveText('AgentHub');
    await expect(wordmark).toHaveCSS('font-size', '20px');
    await expect(wordmark).toHaveCSS('font-weight', '600');
    await touchTarget(link);
    const outer = (await link.boundingBox())!;
    const inner = (await wordmark.boundingBox())!;
    expect(Math.abs(outer.y + outer.height / 2 - inner.y - inner.height / 2)).toBeLessThanOrEqual(
      1,
    );
    await info.attach(`${name}-geometry`, {
      body: JSON.stringify({ treatment: 'plain-wordmark', outer, inner }),
      contentType: 'application/json',
    });
    await info.attach(`${name}-brand`, { body: await link.screenshot(), contentType: 'image/png' });
    return;
  }
  const slot = link.locator('.agenthub-logo');
  const graphic = slot.locator(':scope > [data-brand-glyph="true"]');
  const wordmark = link.locator(':scope > span').filter({ hasText: /^AgentHub$/ });
  await expect(graphic).toHaveCount(1);
  await expect(wordmark).toHaveCount(0);
  const geometry = await slot.evaluate(async (node) => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const graphic = node.querySelector(':scope > [data-brand-glyph="true"]')!;
    const wordmark = Array.from(node.parentElement!.children).find(
      (child) => child !== node && child.textContent?.trim() === 'AgentHub',
    );
    const maskImage = getComputedStyle(graphic).maskImage;
    const source = /^url\(["']?(.*?)["']?\)$/.exec(maskImage)?.[1];
    if (!source) throw new Error('Brand mask is missing its image URL');
    const image = new Image();
    image.src = source;
    await image.decode();
    return {
      maskImage,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      slot: box(node),
      graphic: box(graphic),
      wordmark: wordmark ? box(wordmark) : null,
      fontSize: wordmark ? getComputedStyle(wordmark).fontSize : null,
    };
  });
  const center = (box: { x: number; y: number; width: number; height: number }) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const a = center(geometry.slot),
    b = center(geometry.graphic);
  expect(Math.abs(geometry.slot.width - 32)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.slot.height - 32)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(geometry.imageWidth).toBeGreaterThan(0);
  expect(geometry.imageHeight).toBeGreaterThan(0);
  await info.attach(`${name}-geometry`, {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await info.attach(`${name}-brand`, { body: await link.screenshot(), contentType: 'image/png' });
}
async function capture(page: Page, header: Locator, info: TestInfo, name: string) {
  await noOverflow(page);
  await info.attach(`${name}-page`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await info.attach(`${name}-header`, {
    body: await header.screenshot(),
    contentType: 'image/png',
  });
}
async function sameAxis(locators: Locator[], info: TestInfo, name: string) {
  const boxes = [];
  for (const locator of locators) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box!);
  }
  for (const box of boxes) expect(Math.abs(box.x - boxes[0]!.x)).toBeLessThanOrEqual(1);
  await info.attach(name, { body: JSON.stringify(boxes), contentType: 'application/json' });
}
for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark']) {
    test(`真实壳层基础品牌与页面轴线 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const { project, agent, session } = await seedWorkspace(context, app);
      await context.addInitScript(
        ({ origin, theme }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { origin: app.origin, theme },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/projects/${project.id}/overview`);
      await expect(
        page.getByRole('heading', { name: 'v1 baseline project', exact: true }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      if (width < 768) {
        const navigation = page.getByRole('button', { name: '打开导航', exact: true });
        await touchTarget(navigation);
        await navigation.click();
        const drawer = page.getByRole('dialog', { name: '导航', exact: true });
        const drawerBox = (await drawer.boundingBox())!;
        expect(Math.abs(drawerBox.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(drawerBox.height - 844)).toBeLessThanOrEqual(1);
        await brandGeometry(
          page.getByRole('link', { name: 'AgentHub 首页', exact: true }).filter({ visible: true }),
          info,
          'app-shell',
        );
        const nav = page
          .getByRole('navigation', { name: '主导航', exact: true })
          .filter({ visible: true });
        for (const label of ['项目', 'Agent 中心', 'Prompt 库'])
          await touchTarget(nav.getByRole('link', { name: label, exact: true }));
        await info.attach('mobile-drawer-touch-targets', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await page.keyboard.press('Escape');
      } else {
        const expand = page.getByRole('button', { name: '展开侧边栏', exact: true });
        const forcedCollapsed = width < 1320;
        if (forcedCollapsed) await expect(expand).toBeDisabled();
        else if (await expand.isVisible()) await expand.click();
        await brandGeometry(
          page.getByRole('link', { name: 'AgentHub 首页', exact: true }),
          info,
          'app-shell',
          forcedCollapsed,
        );
      }
      const projectHeader = page.locator('header[class*="_projectContext_"]');
      const projectTabs = page.getByRole('navigation', { name: '项目上下文', exact: true });
      if (width < 768) {
        const headerGeometry = await projectHeader.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const css = getComputedStyle(element);
          return {
            right: box.right - parseFloat(css.paddingRight),
            width: element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
          };
        });
        const create = projectHeader
          .getByRole('link', { name: '新建工作', exact: true })
          .getByRole('button');
        await touchTarget(create);
        const createBox = (await create.boundingBox())!;
        expect(Math.abs(createBox.x + createBox.width - headerGeometry.right)).toBeLessThanOrEqual(
          1,
        );
        const details = projectHeader
          .locator('details')
          .filter({ has: page.locator('summary', { hasText: '项目详情' }) });
        const summary = details.locator('summary');
        const tabsBox = (await projectTabs.boundingBox())!;
        const summaryBox = (await summary.boundingBox())!;
        expect(tabsBox.y).toBeLessThan(summaryBox.y + summaryBox.height);
        expect(summaryBox.y).toBeLessThan(tabsBox.y + tabsBox.height);
        expect(tabsBox.x + tabsBox.width).toBeLessThanOrEqual(summaryBox.x + 1);
        await summary.click();
        const detailsBox = (await details.boundingBox())!;
        expect(Math.abs(detailsBox.width - headerGeometry.width)).toBeLessThanOrEqual(1);
        expect(detailsBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);
        await touchTarget(details.getByRole('button', { name: '编辑类型', exact: true }));
        await noOverflow(page);
        await info.attach('project-mobile-details', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await summary.click();
      }
      if (width >= 768)
        await sameAxis(
          [
            projectHeader.locator('[class*="_identityRow_"]'),
            projectTabs,
            page.locator('[class*="_overviewGrid_"]'),
          ],
          info,
          'project-header-tabs-body-axis',
        );
      else await touchTarget(projectHeader.getByRole('button', { name: '新建工作', exact: true }));
      if (width >= 768) {
        const main = (await page.locator('#main-content').boundingBox())!;
        const axis = (await projectHeader.locator('[class*="_identityRow_"]').boundingBox())!;
        expect(Math.abs(axis.x - main.x - 24)).toBeLessThanOrEqual(1);
      }
      await capture(page, projectHeader, info, 'project');

      await page.goto(`/agents/${agent.id}`);
      const agentTitle = page.getByRole('heading', { name: 'v1 baseline agent', exact: true });
      await expect(agentTitle).toBeVisible();
      const agentHeader = page.locator('header').filter({ has: agentTitle });
      await sameAxis(
        [agentTitle, page.getByRole('heading', { name: '默认设置', exact: true })],
        info,
        'agent-header-body-axis',
      );
      if (width >= 768) {
        const main = (await page.locator('#main-content').boundingBox())!;
        const title = (await agentTitle.boundingBox())!;
        expect(Math.abs(title.x - main.x - 24)).toBeLessThanOrEqual(1);
      }
      const availability = page.getByRole('heading', { name: '接收新工作', exact: true });
      const defaults = page.getByRole('heading', { name: '默认设置', exact: true });
      await expect(availability).toBeVisible();
      expect((await availability.boundingBox())!.y).toBeLessThan((await defaults.boundingBox())!.y);
      const saveDefaults = page.getByRole('button', { name: '保存默认设置', exact: true });
      await touchTarget(saveDefaults);
      expect((await saveDefaults.boundingBox())!.width).toBeLessThan(300);
      await expect(defaults.locator('..')).toHaveCSS('border-bottom-width', '0px');
      await page.locator('#main-content').evaluate((element) => {
        element.scrollTop = 0;
      });
      await capture(page, agentHeader, info, 'agent');

      await page.goto(`/workspace/${session.id}`);
      const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
      await expect(composer).toBeEnabled();
      await composer.fill('壳层验收草稿，不发送');
      // Below the persistent-rail breakpoint, open explicitly: a collapsed rail
      // can retain a 1px transparent box that still passes visibility checks.
      if (width < 1180) {
        const auxiliary = page.getByRole('button', { name: '打开辅助栏', exact: true });
        if (width < 768) await touchTarget(auxiliary);
        await auxiliary.click();
      }
      await brandGeometry(
        page.locator('.codex-rail-brand').filter({ visible: true }),
        info,
        'workspace',
      );
      await info.attach('workspace-navigation', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.keyboard.press('Escape');
      await expect(composer).toHaveValue('壳层验收草稿，不发送');
      await capture(page, page.locator('.workspace-contextbar'), info, 'workspace');
      expect(errors).toEqual([]);
    });
  }
