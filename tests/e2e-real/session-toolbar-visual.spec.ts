import type { Locator, Page, TestInfo } from '@playwright/test';
import { apiData, seedWorkspace } from './baseline-support.js';
import { test, expect } from './fixtures.js';
import { seedLongSessionContext } from './session-context-support.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(180_000);

type Box = { x: number; y: number; width: number; height: number };
const sameRow = (boxes: Box[]) =>
  Math.min(...boxes.map((box) => box.y + box.height)) > Math.max(...boxes.map((box) => box.y));

async function captureToolbar(page: Page, info: TestInfo, state: string, expanded: boolean) {
  const toolbar = page.locator('[aria-label="会话筛选"]');
  const controls: Record<string, Locator> = {
    search: toolbar.getByRole('textbox', { name: '搜索会话', exact: true }),
    count: toolbar.getByText('1 个会话', { exact: true }),
    create: toolbar.getByRole('button', { name: '新建会话', exact: true }),
  };
  const width = page.viewportSize()!.width;
  if (width >= 768 || expanded) {
    controls.agent = toolbar.getByRole('combobox', { name: '会话 Agent', exact: true });
    controls.status = toolbar.getByRole('combobox', { name: '会话状态', exact: true });
  }
  if (width < 768) {
    controls.toggle = toolbar.getByRole('button', { name: /^筛选/ });
    const clear = toolbar.getByRole('button', { name: '清除条件', exact: true });
    if (await clear.count()) controls.clear = clear;
  }
  const boxes: Record<string, Box> = {};
  const text: Record<
    string,
    Array<{ left: number; right: number; top: number; bottom: number }>
  > = {};
  for (const [name, control] of Object.entries(controls)) {
    await expect(control).toBeVisible();
    boxes[name] = (await control.boundingBox())!;
    text[name] = await control.evaluate((node) => {
      const result = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let child = walker.nextNode(); child; child = walker.nextNode()) {
        if (!child.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const rect of range.getClientRects())
          result.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
      return result;
    });
  }
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  const path = info.outputPath(`session-toolbar-${state}.png`);
  await page.screenshot({ path });
  await info.attach(`session-toolbar-${state}`, { path, contentType: 'image/png' });
  await info.attach(`session-toolbar-${state}-geometry`, {
    body: JSON.stringify({ boxes, text, viewport }),
    contentType: 'application/json',
  });
  expect(viewport.overflow).toBeLessThanOrEqual(1);
  const entries = Object.entries(boxes);
  for (const [name, box] of entries) {
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width + 1);
    for (const rect of text[name]!) {
      expect(rect.left, name).toBeGreaterThanOrEqual(box.x - 1);
      expect(rect.right, name).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(rect.top, name).toBeGreaterThanOrEqual(box.y - 1);
      expect(rect.bottom, name).toBeLessThanOrEqual(box.y + box.height + 1);
    }
  }
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const [aName, a] = entries[i]!,
        [bName, b] = entries[j]!;
      expect(
        a.x + a.width <= b.x + 1 ||
          b.x + b.width <= a.x + 1 ||
          a.y + a.height <= b.y + 1 ||
          b.y + b.height <= a.y + 1,
        `${aName}/${bName} overlap`,
      ).toBe(true);
    }
  if (width >= 960) {
    expect(sameRow([boxes.search!, boxes.agent!, boxes.status!, boxes.count!, boxes.create!])).toBe(
      true,
    );
  } else if (width >= 768) {
    expect(sameRow([boxes.search!, boxes.count!, boxes.create!])).toBe(true);
    expect(sameRow([boxes.agent!, boxes.status!])).toBe(true);
    expect(Math.min(boxes.agent!.y, boxes.status!.y)).toBeGreaterThanOrEqual(
      Math.max(...[boxes.search!, boxes.count!, boxes.create!].map((box) => box.y + box.height)),
    );
  }
  if (width < 768) {
    for (const name of [
      'create',
      'toggle',
      ...(expanded ? ['agent', 'status'] : []),
      ...(controls.clear ? ['clear'] : []),
    ]) {
      expect(boxes[name]!.height, name).toBeGreaterThanOrEqual(44);
      expect(boxes[name]!.width, name).toBeGreaterThanOrEqual(44);
    }
  }
}

async function verifySessionContext(
  page: Page,
  info: TestInfo,
  link: Locator,
  expected: {
    title: string;
    model: string | null;
    branch: string | null;
    cwd: string;
    agentName?: string;
  },
  capturePrefix = 'session-context',
) {
  const row = link.locator('..');
  const details = row.locator(':scope > details');
  const summary = details.locator(':scope > summary');
  const fields = details.locator(':scope > dl');
  const originalUrl = page.url();
  await expect(row).toHaveJSProperty('tagName', 'ARTICLE');
  await expect(details).toHaveCount(1);
  await expect(summary).toHaveAccessibleName(`查看会话上下文：${expected.title}`);
  await expect(
    link.locator('a,button,summary,details,input,select,textarea,[role="button"],[tabindex]'),
  ).toHaveCount(0);
  await expect(details).not.toHaveAttribute('open', '');
  await summary.scrollIntoViewIfNeeded();
  const defaultGeometry = { link: await link.boundingBox(), summary: await summary.boundingBox() };
  const defaultPath = info.outputPath(`${capturePrefix}-default.png`);
  await page.screenshot({ path: defaultPath });
  await info.attach(`${capturePrefix}-default`, { path: defaultPath, contentType: 'image/png' });
  await info.attach(`${capturePrefix}-default-geometry`, {
    body: JSON.stringify(defaultGeometry),
    contentType: 'application/json',
  });
  const a = defaultGeometry.link!,
    b = defaultGeometry.summary!;
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(
    a.x + a.width <= b.x + 1 ||
      b.x + b.width <= a.x + 1 ||
      a.y + a.height <= b.y + 1 ||
      b.y + b.height <= a.y + 1,
  ).toBe(true);
  await link.focus();
  await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  await expect(page).toHaveURL(originalUrl);
  await expect(fields.locator('dd')).toHaveText([
    expected.title,
    expected.agentName ?? 'v1 baseline agent',
    expected.model || '模型未记录',
    expected.branch || '分支未记录',
    expected.cwd || '目录未记录',
  ]);
  const geometry = [];
  for (const field of await fields.locator('dd').all()) {
    // The disclosure remains in document flow. Reading each field may scroll;
    // do not demand that the full expanded context fit a single viewport.
    await field.scrollIntoViewIfNeeded();
    geometry.push(
      await field.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const panel = node.closest('dl')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          text: node.textContent,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          viewportWidth: innerWidth,
          documentOverflow: document.documentElement.scrollWidth - innerWidth,
          bounds: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
          rects: Array.from(range.getClientRects()).map((rect) => ({
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          })),
        };
      }),
    );
  }
  const expandedPath = info.outputPath(`${capturePrefix}-expanded-full-page.png`);
  await page.screenshot({ path: expandedPath, fullPage: true });
  await info.attach(`${capturePrefix}-expanded-full-page`, {
    path: expandedPath,
    contentType: 'image/png',
  });
  await info.attach(`${capturePrefix}-expanded-geometry`, {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  for (const field of geometry) {
    expect(field.documentOverflow).toBeLessThanOrEqual(1);
    expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth + 1);
    for (const rect of field.rects) {
      expect(rect.left).toBeGreaterThanOrEqual(
        Math.max(0, field.bounds.left, field.panel.left) - 1,
      );
      expect(rect.right).toBeLessThanOrEqual(
        Math.min(field.viewportWidth, field.bounds.right, field.panel.right) + 1,
      );
      expect(rect.top).toBeGreaterThanOrEqual(Math.max(field.bounds.top, field.panel.top) - 1);
      expect(rect.bottom).toBeLessThanOrEqual(
        Math.min(field.bounds.bottom, field.panel.bottom) + 1,
      );
    }
  }
  await summary.scrollIntoViewIfNeeded();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(fields).toBeHidden();
  await expect(summary).toBeFocused();
  await expect(page).toHaveURL(originalUrl);
}

for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark']) {
    test(`真实项目会话工具栏 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const { project, session } = await seedWorkspace(context, app);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript((theme) => localStorage.setItem('agenthub-theme', theme), theme);
      await page.goto(`/projects/${project.id}/sessions`);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const sessionLink = page
        .getByRole('region', { name: '项目会话', exact: true })
        .locator(`a[href="/workspace/${session.id}"]`);
      await expect(sessionLink).toHaveCount(1);
      await expect(sessionLink).toBeVisible();
      const toolbar = page.locator('[aria-label="会话筛选"]');
      const status = toolbar.getByRole('combobox', { name: '会话状态', exact: true });
      await captureToolbar(page, info, 'default', false);
      if (width < 768) {
        await expect(status).toBeHidden();
        const toggle = toolbar.getByRole('button', { name: '筛选', exact: true });
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await captureToolbar(page, info, 'expanded', true);
      }
      // The real seeded session contributes its actual status; choose that option
      // rather than inventing another server state or intercepting the response.
      const label = (await sessionLink.getByRole('status').innerText()).trim();
      expect(label).not.toBe('');
      expect(label).not.toBe('全部状态');
      expect(label).not.toBe('清除选择');
      await status.click();
      const choice = page.getByRole('option', { name: label, exact: true });
      await expect(choice).toHaveCount(1);
      await choice.click();
      await expect(status).toContainText(label);
      await expect(sessionLink).toBeVisible();
      if (width < 768) {
        await expect(toolbar.getByRole('button', { name: '筛选（1）', exact: true })).toBeVisible();
        await expect(toolbar.getByRole('button', { name: '清除条件', exact: true })).toBeVisible();
        await captureToolbar(page, info, 'filtered', true);
      }
      await status.click();
      await page.getByRole('option', { name: '全部状态', exact: true }).click();
      await expect(status).toContainText('全部状态');
      if (width < 768) {
        const toggle = toolbar.getByRole('button', { name: '筛选', exact: true });
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(status).toBeHidden();
        await expect(toggle).toBeFocused();
      }
      await expect(sessionLink).toBeVisible();
      await captureToolbar(page, info, 'restored', false);
      const saved = await apiData<{
        title: string;
        model: string | null;
        branch: string | null;
        cwd: string;
      }>(context, 'get', `/sessions/${session.id}`);
      await verifySessionContext(page, info, sessionLink, saved);
      await sessionLink.scrollIntoViewIfNeeded();
      await sessionLink.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/workspace/${session.id}$`));
    });
  }

async function verifyProjectHeaderFacts(page: Page, info: TestInfo, branch: string) {
  const facts = page.getByRole('group', { name: '项目元信息', exact: true });
  await expect(facts).toBeVisible();
  await expect(facts).toContainText(`最近会话分支：${branch}`);
  await expect(facts).toContainText('Git 仓库');
  await expect(facts).toContainText('1 个登记可用 Agent');
  await expect(facts).toContainText('0 项未结束工作');
  const spans = facts.locator(':scope > div > span');
  await expect(spans).toHaveCount(4);
  const geometry = await spans.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      return {
        text: node.textContent,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        viewportWidth: innerWidth,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        rects: Array.from(range.getClientRects()).map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        })),
      };
    }),
  );
  const path = info.outputPath('project-header-long-facts.png');
  await page.screenshot({ path });
  await info.attach('project-header-long-facts', { path, contentType: 'image/png' });
  await info.attach('project-header-facts-geometry', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  for (const item of geometry) {
    expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
    for (const rect of item.rects) {
      expect(rect.left).toBeGreaterThanOrEqual(Math.max(0, item.left) - 1);
      expect(rect.right).toBeLessThanOrEqual(Math.min(item.viewportWidth, item.right) + 1);
      expect(rect.top).toBeGreaterThanOrEqual(item.top - 1);
      expect(rect.bottom).toBeLessThanOrEqual(item.bottom + 1);
    }
  }
}

// Real application + opt-in ACP test provider, not a claim about hosted model support.
// Existing short-fixture toolbar/navigation cases above remain unchanged.
for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark']) {
    test(`真实项目会话长字段 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const seeded = await seedLongSessionContext(context, app);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript((theme) => localStorage.setItem('agenthub-theme', theme), theme);
      await page.goto(`/projects/${seeded.project.id}/sessions`);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const region = page.getByRole('region', { name: '项目会话', exact: true });
      const link = region.locator(`a[href="/workspace/${seeded.session.id}"]`);
      const peer = region.locator(`a[href="/workspace/${seeded.peerSession.id}"]`);
      await expect(link).toHaveCount(1);
      await expect(peer).toHaveCount(1);
      await expect(link).toBeVisible();
      await expect(peer).toBeVisible();
      if (width >= 768) await verifyProjectHeaderFacts(page, info, seeded.expected.branch);
      await expect(link).toContainText('client-web');
      await expect(peer).toContainText('client-web');
      for (const rowLink of [link, peer]) {
        const directory = rowLink.getByText('client-web', { exact: true });
        await expect(directory).toHaveCount(1);
        await directory.scrollIntoViewIfNeeded();
        const visible = await directory.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(node);
          return {
            left: box.left,
            right: box.right,
            width: innerWidth,
            rects: Array.from(range.getClientRects()).map((r) => ({
              left: r.left,
              right: r.right,
            })),
          };
        });
        await info.attach(`directory-label-${rowLink === link ? 'primary' : 'peer'}`, {
          body: JSON.stringify(visible),
          contentType: 'application/json',
        });
        for (const rect of visible.rects) {
          expect(rect.left).toBeGreaterThanOrEqual(Math.max(0, visible.left) - 1);
          expect(rect.right).toBeLessThanOrEqual(Math.min(visible.width, visible.right) + 1);
        }
      }
      const saved = await apiData<{
        title: string;
        model: string | null;
        branch: string | null;
        cwd: string;
      }>(context, 'get', `/sessions/${seeded.session.id}`);
      const peerSaved = await apiData<{
        title: string;
        model: string | null;
        branch: string | null;
        cwd: string;
      }>(context, 'get', `/sessions/${seeded.peerSession.id}`);
      expect(saved.cwd).not.toBe(peerSaved.cwd);
      expect(saved.cwd.endsWith('/client-web')).toBe(true);
      expect(peerSaved.cwd.endsWith('/client-web')).toBe(true);
      expect(saved.model).toBe(seeded.expected.model);
      expect(saved.branch).toBe(seeded.expected.branch);
      expect(saved.title).toBe(seeded.expected.title);
      await expect(link.locator('..').locator('dl dd').last()).toHaveText(saved.cwd);
      await expect(peer.locator('..').locator('dl dd').last()).toHaveText(peerSaved.cwd);
      await verifySessionContext(page, info, link, {
        ...saved,
        agentName: seeded.expected.agentName,
      });
      await verifySessionContext(
        page,
        info,
        peer,
        {
          ...peerSaved,
          agentName: seeded.peerExpected.agentName,
        },
        'session-context-peer',
      );
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/workspace/${seeded.session.id}$`));
    });
  }
