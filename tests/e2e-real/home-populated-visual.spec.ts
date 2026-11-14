import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { apiData } from './baseline-support.js';
import { initializeGitProject, test, expect, type RealApp } from './fixtures.js';

type Identified = { id: string };
type AttentionTask = Identified & { title: string; projectId: string; status: string };
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

async function seedPopulatedHome(context: BrowserContext, app: RealApp) {
  await initializeGitProject(app.projectRoot);
  const target = await apiData<Identified>(context, 'post', '/execution-targets', {
    name: '首页视觉验收本地环境',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  const project = await apiData<Identified>(context, 'post', '/projects', {
    name: '正式项目：跨团队工程协作与长中文上下文的持续交付验收',
    targetId: target.id,
    rootPath: app.projectRoot,
    kind: 'STANDARD',
  });
  const agent = await apiData<Identified>(context, 'post', '/agents', {
    name: '首页视觉验收 Agent',
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: process.execPath,
    args: [resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/acp/fake-agent.mjs')],
  });
  const preflight = await apiData<{ status: string }>(
    context,
    'post',
    `/agents/${agent.id}/preflight`,
    { cwd: app.projectRoot },
  );
  expect(preflight.status).toBe('READY');
  const tasks: AttentionTask[] = [];
  for (let index = 0; index < 7; index++) {
    const finalStatus = index % 2 ? 'WAITING_REVIEW' : 'BLOCKED';
    const task = await apiData<AttentionTask>(context, 'post', '/tasks', {
      projectId: project.id,
      title: `事项 ${index + 1}：${finalStatus === 'BLOCKED' ? '等待处理依赖阻塞' : '等待审阅交付结果'}，核对跨项目协作中的长中文标题换行与操作入口是否始终清晰可见`,
      description:
        '这是通过真实任务 API 创建并按允许的状态机迁移的视觉样本；不代表 Agent 已实际执行任务。',
    });
    // Only supported transitions, no database edits or fabricated API payloads.
    const transitions =
      finalStatus === 'BLOCKED' ? ['READY', 'BLOCKED'] : ['READY', 'IN_PROGRESS', 'WAITING_REVIEW'];
    for (const status of transitions) {
      const transitioned = await apiData<AttentionTask>(
        context,
        'post',
        `/tasks/${task.id}/transition`,
        { status },
      );
      expect(transitioned.status).toBe(status);
    }
    tasks.push({ ...task, status: finalStatus });
  }
  const sessions: Array<Identified & { title: string }> = [];
  for (let index = 0; index < 3; index++) {
    const session = await apiData<Identified & { title: string }>(context, 'post', '/sessions', {
      projectId: project.id,
      agentId: agent.id,
      cwd: app.projectRoot,
      branch: 'main',
      title: `最近会话 ${index + 1}：继续检查移动端与桌面端的工程上下文以及长中文名称展示`,
    });
    sessions.push(session);
  }
  const dashboard = await apiData<{ attentionTasks: AttentionTask[]; pendingApprovals: unknown[] }>(
    context,
    'get',
    '/dashboard',
  );
  expect(dashboard.attentionTasks.map((task) => task.id).sort()).toEqual(
    tasks.map((task) => task.id).sort(),
  );
  for (const task of tasks) {
    expect(dashboard.attentionTasks.find((item) => item.id === task.id)).toMatchObject({
      projectId: project.id,
      status: task.status,
    });
  }
  // Approval lifecycle is covered elsewhere; do not label seeded tasks as approvals.
  expect(dashboard.pendingApprovals).toHaveLength(0);
  return { project, tasks, sessions };
}

async function assertHomeGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector('main');
    const regions = [...document.querySelectorAll<HTMLElement>('main section[aria-labelledby]')];
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: main?.clientWidth,
      mainScrollWidth: main?.scrollWidth,
      regions: regions.map((region) => {
        const rect = region.getBoundingClientRect();
        return {
          label: region.getAttribute('aria-labelledby'),
          left: rect.left,
          right: rect.right,
          width: region.clientWidth,
          scrollWidth: region.scrollWidth,
        };
      }),
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.mainWidth).toBeGreaterThan(0);
  expect(geometry.mainScrollWidth!).toBeLessThanOrEqual(geometry.mainWidth! + 1);
  for (const region of geometry.regions) {
    expect(region.left, region.label ?? 'section').toBeGreaterThanOrEqual(-1);
    expect(region.right, region.label ?? 'section').toBeLessThanOrEqual(geometry.viewport + 1);
    expect(region.scrollWidth, region.label ?? 'section').toBeLessThanOrEqual(region.width + 1);
  }
  return geometry;
}

// Computed font-family and FontFaceSet availability do not identify the font
// that actually painted Chinese glyphs. Ask the same CI Chromium via CDP; do
// not infer its installed fonts from the machine running source-only checks.
async function collectChineseFontEvidence(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const targets = [
    { label: '中文主标题', selector: 'main h1' },
    {
      label: '中文说明正文',
      selector: 'section[aria-labelledby="home-attention-title"] > div > p',
    },
    { label: '英文 Agent 与中文混排', selector: 'main header > div > p' },
  ];
  const environment = await page.evaluate(() => ({
    url: location.href,
    userAgent: navigator.userAgent,
    languages: navigator.languages,
    documentLang: document.documentElement.lang,
    fontSetStatus: document.fonts.status,
    fontFaces: Array.from(document.fonts, (face) => ({
      family: face.family,
      status: face.status,
      weight: face.weight,
      style: face.style,
      display: face.display,
      unicodeRange: face.unicodeRange,
    })),
  }));
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');
    const samples = [];
    for (const target of targets) {
      const locator = page.locator(target.selector);
      await expect(locator).toHaveCount(1);
      const computed = await locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          text: element.textContent?.trim() ?? '',
          lang: element.closest('[lang]')?.getAttribute('lang'),
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          fontSynthesis: style.fontSynthesis,
        };
      });
      // Existing product nodes only: pure Chinese samples identify fallback;
      // the header sentence's sole Latin word (Agent) verifies the bundled font.
      const hasLatin = target.label === '英文 Agent 与中文混排';
      if (hasLatin) {
        expect(computed.text.match(/[A-Za-z]+/g)).toEqual(['Agent']);
      } else {
        expect(computed.text, target.label).toMatch(/^[\p{Script=Han}\p{Punctuation}\s]+$/u);
      }
      expect(computed.fontFamily).toContain('Geist Variable');
      if (target.selector === 'main h1') {
        expect(computed.fontWeight).toBe('650');
        // Permission to synthesize weight, not proof of a native CJK 650 face
        // or proof that Chromium actually synthesized it. Review the pixels too.
        expect(computed.fontSynthesis).toBe('weight');
      } else {
        expect(computed.fontSynthesis).toBe('none');
      }
      const { nodeId } = await client.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: target.selector,
      });
      expect(nodeId, target.label).toBeGreaterThan(0);
      const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
      expect(
        fonts.some((font) => font.glyphCount > 0),
        target.label,
      ).toBe(true);
      if (hasLatin) {
        expect(
          fonts.some(
            (font) => font.isCustomFont && /Geist/i.test(font.familyName) && font.glyphCount >= 5,
          ),
          'Agent must actually render with bundled Geist',
        ).toBe(true);
      }
      // Also require custom CJK glyphs in the mixed Chinese/Agent sentence.
      expect(
        fonts.some(
          (font) =>
            font.glyphCount > 0 && font.isCustomFont && /Noto Sans SC/i.test(font.familyName),
        ),
        'Chinese must actually render with self-hosted Noto Sans SC',
      ).toBe(true);
      samples.push({ ...target, computed, platformFonts: fonts });
    }
    return {
      environment,
      samples,
      note: 'Platform fonts are actual Chromium glyph usage; fontSetStatus and computed fontFamily are context, not proof of a specific fallback.',
    };
  } finally {
    await client.detach();
  }
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe('Home populated real-service visual acceptance', () => {
  test.use({ authMode: 'local_trusted' });
  test('正式项目、七条待处理事项与最近会话在四宽双主题保持可操作', async ({
    browser,
    context,
    app,
  }, testInfo) => {
    test.setTimeout(360_000);
    const fixture = await seedPopulatedHome(context, app);
    const report: unknown[] = [];
    for (const theme of ['light', 'dark'] as const) {
      for (const viewport of viewports) {
        const name = `home-populated-${theme}-${viewport.width}`;
        const visualContext = await browser.newContext({ baseURL: app.origin, viewport });
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const failedApi: string[] = [];
        try {
          await visualContext.addInitScript(
            ({ theme, origin }) => {
              if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
            },
            { theme, origin: app.origin },
          );
          const page = await visualContext.newPage();
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
          });
          page.on('pageerror', (error) => pageErrors.push(error.message));
          page.on('response', (response) => {
            if (response.url().startsWith(`${app.origin}/api/v1/`) && response.status() >= 400)
              failedApi.push(
                `${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`,
              );
          });
          await page.goto('/home');
          await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
          await expect(page.getByRole('heading', { name: '继续工作', exact: true })).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const create = page.getByRole('link', { name: '新建工作', exact: true });
          await expect(create).toHaveAttribute('href', `/projects/${fixture.project.id}/work/new`);
          await expect(create).toBeInViewport();
          const attention = page.getByRole('region', { name: /^需要你处理/ });
          await expect(attention.getByRole('heading')).toContainText('7');
          await expect(attention.getByRole('link')).toHaveCount(5);
          await page.evaluate(() => document.fonts.ready);
          const fontResources = await page.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .filter((entry) => /\.woff2?(?:$|\?)/i.test(entry.name))
              .map((entry) => {
                const resource = entry as PerformanceResourceTiming;
                return {
                  url: resource.name,
                  sameOrigin: new URL(resource.name).origin === location.origin,
                  transferSize: resource.transferSize,
                  encodedBodySize: resource.encodedBodySize,
                  decodedBodySize: resource.decodedBodySize,
                };
              }),
          );
          expect(fontResources.every((resource) => resource.sameOrigin)).toBe(true);
          const cjkResources = fontResources.filter((resource) =>
            /noto-sans-sc/i.test(resource.url),
          );
          expect(cjkResources.length).toBeGreaterThan(0);
          const cjkEncodedBytes = cjkResources.reduce((sum, item) => sum + item.encodedBodySize, 0);
          expect(cjkEncodedBytes).toBeGreaterThan(0);
          expect(
            cjkEncodedBytes,
            'cold Home must not eagerly load the complete CJK family',
          ).toBeLessThan(2 * 1024 * 1024);
          const initialGeometry = await assertHomeGeometry(page);
          await capture(page, testInfo, `${name}-collapsed`);
          // The disclosure must be driven by actual clipped pixels, not string length.
          const detailButtons = attention.getByRole('button', { name: /^展开详情：/ });
          if (viewport.width <= 860) {
            const firstTitle = attention.getByRole('link').first().locator('strong');
            await expect(firstTitle).toHaveCSS('-webkit-line-clamp', '2');
            for (const row of await attention.getByRole('link').all()) {
              const hasDetails = await row.locator('..').getAttribute('data-has-details');
              await expect(row).toHaveCSS('padding-bottom', hasDetails === 'true' ? '0px' : '14px');
            }
            if (viewport.width === 390) await expect(detailButtons.first()).toBeVisible();
            if (await detailButtons.count()) {
              const detailButton = detailButtons.first();
              const contentId = await detailButton.getAttribute('aria-controls');
              expect(contentId).toBeTruthy();
              const content = page.locator(`[id="${contentId}"]`);
              const rowLink = content.locator('..');
              const destination = await rowLink.getAttribute('href');
              await expect(detailButton).toHaveAttribute('aria-expanded', 'false');
              expect(await detailButton.evaluate((node) => node.closest('a'))).toBeNull();
              await detailButton.focus();
              await page.keyboard.press('Enter');
              const collapseDetails = attention.getByRole('button', { name: /^收起详情：/ });
              await expect(collapseDetails).toHaveAttribute('aria-expanded', 'true');
              expect(
                await content.evaluate((node) =>
                  Array.from(node.children).every(
                    (child) => child.scrollHeight <= child.clientHeight + 1,
                  ),
                ),
              ).toBe(true);
              await expect(rowLink).toHaveAttribute('href', destination!);
              await capture(page, testInfo, `${name}-item-detail`);
              await collapseDetails.focus();
              await page.keyboard.press('Space');
              await expect(attention.getByRole('button', { name: /^收起详情：/ })).toHaveCount(0);
              await expect(detailButton).toBeFocused();
              await expect(rowLink).toHaveAttribute('href', destination!);
              await expect(attention.getByRole('link')).toHaveCount(5);
            }
          } else {
            await expect(detailButtons).toHaveCount(0);
          }
          const chineseFonts = await collectChineseFontEvidence(page);
          await testInfo.attach(`${name}-chinese-fonts`, {
            body: JSON.stringify({ theme, viewport, ...chineseFonts }, null, 2),
            contentType: 'application/json',
          });
          const expand = attention.getByRole('button', { name: '查看全部 7 项待处理事项' });
          await expect(expand).toHaveAttribute('aria-expanded', 'false');
          await expand.click();
          await expect(attention.getByRole('link')).toHaveCount(7);
          for (const task of fixture.tasks) {
            const row = attention.getByRole('link').filter({ hasText: task.title });
            await expect(row).toHaveCount(1);
            await expect(row).toHaveAttribute(
              'href',
              `/projects/${fixture.project.id}/work?task=${task.id}`,
            );
            await expect(row).toContainText(task.status === 'WAITING_REVIEW' ? '审阅' : '查看');
          }
          await attention.getByRole('heading').scrollIntoViewIfNeeded();
          await capture(page, testInfo, `${name}-expanded-top`);
          const lastRow = attention.getByRole('link').last();
          await lastRow.scrollIntoViewIfNeeded();
          await expect(lastRow).toBeInViewport();
          const expandedGeometry = await assertHomeGeometry(page);
          await capture(page, testInfo, `${name}-expanded-tail`);
          const collapse = attention.getByRole('button', { name: '收起待处理事项' });
          await expect(collapse).toHaveAttribute('aria-expanded', 'true');
          await collapse.click();
          await expect(attention.getByRole('link')).toHaveCount(5);
          await expect(
            attention.getByRole('button', { name: '查看全部 7 项待处理事项' }),
          ).toHaveAttribute('aria-expanded', 'false');
          const recent = page.getByRole('region', { name: '继续最近工作' });
          await recent.scrollIntoViewIfNeeded();
          await expect(recent.getByRole('link')).toHaveCount(3);
          for (const session of fixture.sessions) {
            await expect(
              recent.getByRole('link').filter({ hasText: session.title }),
            ).toHaveAttribute('href', `/workspace/${session.id}`);
          }
          await capture(page, testInfo, `${name}-recent`);
          await assertHomeGeometry(page);
          expect(consoleErrors, `${name} console errors`).toEqual([]);
          expect(pageErrors, `${name} page errors`).toEqual([]);
          expect(failedApi, `${name} API failures`).toEqual([]);
          report.push({
            theme,
            viewport,
            initialGeometry,
            fontResources,
            cjkEncodedBytes,
            expandedGeometry,
            chineseFonts,
            consoleErrors,
            pageErrors,
            failedApi,
          });
        } finally {
          await testInfo.attach(`${name}-diagnostics`, {
            body: JSON.stringify(
              { theme, viewport, consoleErrors, pageErrors, failedApi },
              null,
              2,
            ),
            contentType: 'application/json',
          });
          await visualContext.close();
        }
      }
    }
    await testInfo.attach('home-populated-evidence', {
      body: JSON.stringify(
        {
          fixture,
          limitations:
            'Tasks use legal manual transitions, sessions are created but not run, no approval is fabricated; this validates Home rendering against the real service, not Agent execution.',
          report,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
});

test.use({ authMode: 'local_trusted' });

test('中文字体网络失败时保留可读回退，不阻断首页主操作', async ({ page, context, app }, info) => {
  const fixture = await seedPopulatedHome(context, app);
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*noto-sans-sc*.woff2', (route) => route.abort('failed'));
  await page.goto('/home');
  const heading = page.getByRole('heading', { name: '继续工作', exact: true });
  await expect(heading).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const failedFonts = await page.evaluate(
    () =>
      Array.from(document.fonts).filter(
        (face) => /Noto Sans SC/i.test(face.family) && face.status === 'error',
      ).length,
  );
  expect(failedFonts).toBeGreaterThan(0);
  const client = await context.newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'main h1',
    });
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(
      fonts.some((font) => font.glyphCount > 0 && !/Geist|Noto Sans SC/i.test(font.familyName)),
    ).toBe(true);
    await info.attach('cjk-network-fallback-fonts', {
      body: JSON.stringify({ failedFonts, fonts }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await client.detach();
  }
  await expect(page.getByRole('link', { name: '新建工作', exact: true })).toHaveAttribute(
    'href',
    `/projects/${fixture.project.id}/work/new`,
  );
  await assertHomeGeometry(page);
  await capture(page, info, 'home-cjk-network-fallback-390');
  expect(pageErrors).toEqual([]);
});
