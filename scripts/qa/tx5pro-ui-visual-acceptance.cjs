/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, document, Event, EventTarget, fetch, process, require, URL, window */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseURL = process.env.AGENTHUB_BASE_URL || 'http://192.168.5.110:3210';
const chromeExecutable =
  process.env.AGENTHUB_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDirectory = path.resolve(
  process.env.AGENTHUB_ACCEPTANCE_OUTPUT || path.join(process.cwd(), 'ui-visual-evidence'),
);

fs.mkdirSync(outputDirectory, { recursive: true });

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  baseURL,
  browser: null,
  checks: [],
  runtimeIssues: [],
  failedRequests: [],
  externalRequests: [],
  screenshots: [],
  result: 'RUNNING',
};

function recordCheck(name, details = {}) {
  report.checks.push({ name, status: 'PASS', ...details });
  console.log(`PASS ${name}`);
}

function trackRuntime(page, label) {
  const baseOrigin = new URL(baseURL).origin;
  page.on('pageerror', (error) => {
    report.runtimeIssues.push({ label, kind: 'pageerror', message: error.message });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      report.runtimeIssues.push({ label, kind: 'console', message: message.text() });
    }
  });
  page.on('requestfailed', (request) => {
    report.failedRequests.push({
      label,
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      report.runtimeIssues.push({
        label,
        kind: 'http',
        status: response.status(),
        url: response.url(),
      });
    }
  });
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (!['data:', 'blob:'].includes(requestUrl.protocol) && requestUrl.origin !== baseOrigin) {
      report.externalRequests.push({ label, url: request.url(), method: request.method() });
    }
  });
}

async function screenshot(page, filename) {
  const outputFilename = filename.replace(/\.png$/, '.jpg');
  await page.screenshot({
    path: path.join(outputDirectory, outputFilename),
    fullPage: true,
    type: 'jpeg',
    quality: 90,
  });
  report.screenshots.push(outputFilename);
}

async function assertNoRootOverflow(page, name) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${name} 根页面横向溢出：${dimensions.scrollWidth}/${dimensions.clientWidth}`,
  );
  recordCheck(name, dimensions);
}

async function installVisualWebSocket(context) {
  await context.addInitScript(() => {
    class VisualWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = VisualWebSocket.CONNECTING;

      constructor() {
        super();
        window.setTimeout(() => {
          this.readyState = VisualWebSocket.OPEN;
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = VisualWebSocket.CLOSED;
        this.dispatchEvent(new Event('close'));
      }
    }

    Object.defineProperty(window, 'WebSocket', { configurable: true, value: VisualWebSocket });
  });
}

async function installOverviewFixtures(context) {
  await installVisualWebSocket(context);
  await context.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data =
      pathname === '/api/v1/auth/status'
        ? {
            mode: 'local_trusted',
            localTrusted: true,
            setupRequired: false,
            authenticated: true,
            user: null,
          }
        : pathname === '/api/v1/dashboard'
          ? {
              pendingApprovals: [],
              attentionTasks: [],
              runningSessions: [],
              recentResults: [],
              agentHealth: [],
            }
          : pathname === '/api/v1/projects'
            ? [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  name: 'AgentHub',
                  description: 'AgentHub 工程控制平面',
                  targetId: '22222222-2222-4222-8222-222222222222',
                  rootPath: '/volume2/Project/AgentHub',
                  realRootPath: '/volume2/Project/AgentHub',
                  repoKind: 'GIT',
                  status: 'ACTIVE',
                },
              ]
            : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, requestId: 'tx5pro-visual-fixture' }),
    });
  });
}

async function installSetupFixture(context) {
  await context.route('**/api/v1/auth/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          mode: 'token',
          localTrusted: false,
          setupRequired: true,
          authenticated: false,
          user: null,
        },
        requestId: 'tx5pro-setup-visual-fixture',
      }),
    });
  });
}

async function inspectPasswordField(input) {
  return input.evaluate((element) => {
    const root = element.closest('.rt-TextFieldRoot');
    return {
      type: element.getAttribute('type'),
      inputOutline: window.getComputedStyle(element).outlineStyle,
      rootOutlineWidth: root ? window.getComputedStyle(root).outlineWidth : '',
      rootBoxShadow: root ? window.getComputedStyle(root).boxShadow : '',
      nativeReveal: window.getComputedStyle(element, '::-ms-reveal').display,
    };
  });
}

async function inspectOverview(page) {
  return page.locator('.dashboard-grid').evaluate((grid) => {
    const panels = [...grid.querySelectorAll(':scope > .dashboard-panel')];
    const gridStyle = window.getComputedStyle(grid);
    const attention = grid.querySelector('.dashboard-attention');
    const attentionStyle = attention ? window.getComputedStyle(attention) : null;
    return {
      panels: panels.length,
      gap: gridStyle.gap,
      background: gridStyle.backgroundColor,
      prioritySections: grid.querySelectorAll('.priority-section').length,
      attentionLeftBorder: attentionStyle?.borderLeftWidth ?? '',
      attentionRightBorder: attentionStyle?.borderRightWidth ?? '',
      attentionBoxShadow: attentionStyle?.boxShadow ?? '',
      maxPanelHeight: Math.max(...panels.map((panel) => panel.getBoundingClientRect().height)),
    };
  });
}

async function run() {
  const healthResponse = await fetch(`${baseURL}/api/v1/health`);
  assert.equal(healthResponse.ok, true, `LAN health 返回 HTTP ${healthResponse.status}`);
  const health = (await healthResponse.json()).data;
  assert.deepEqual(
    { status: health.status, version: health.version, database: health.database, web: health.web },
    { status: 'ok', version: '0.3.0', database: 'pglite', web: true },
  );
  recordCheck('正式服务健康', health);

  const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  report.browser = browser.version();

  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      trackRuntime(page, `login-${width}`);
      await page.goto(`${baseURL}/overview`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '登录 AgentHub' }).waitFor();
      assert.equal(await page.locator('.access-heading .agenthub-logo svg').count(), 1);
      assert.equal(await page.getByRole('button', { name: '显示密码' }).count(), 1);
      await assertNoRootOverflow(page, `${width} 登录页无根页面横向溢出`);
      await screenshot(page, `login-${width}.png`);
      await context.close();
    }

    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await installSetupFixture(context);
      const page = await context.newPage();
      trackRuntime(page, `setup-${width}`);
      await page.goto(`${baseURL}/overview`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '创建管理员账号' }).waitFor();
      assert.equal(await page.locator('.access-heading .agenthub-logo svg').count(), 1);
      assert.equal(await page.getByRole('button', { name: '显示密码' }).count(), 2);
      const confirmation = page.getByLabel('确认密码');
      await confirmation.fill('123123');
      await confirmation.focus();
      const passwordField = await inspectPasswordField(confirmation);
      assert.equal(passwordField.type, 'password');
      assert.equal(passwordField.inputOutline, 'none');
      assert.equal(passwordField.rootOutlineWidth, '2px');
      assert.equal(passwordField.rootBoxShadow, 'none');
      assert.ok(
        ['', 'none'].includes(passwordField.nativeReveal),
        `浏览器原生密码眼睛仍然可见：${passwordField.nativeReveal}`,
      );
      recordCheck(`${width} 首次设置页仅保留统一密码眼睛`, passwordField);
      await assertNoRootOverflow(page, `${width} 首次设置页无根页面横向溢出`);
      await screenshot(page, `setup-${width}.png`);
      await context.close();
    }

    for (const width of [1440, 1024, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await installOverviewFixtures(context);
      const page = await context.newPage();
      trackRuntime(page, `overview-${width}`);
      await page.goto(`${baseURL}/overview`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '今天需要处理什么' }).waitFor();
      await page.locator('.connection-pill.online').filter({ hasText: '已连接' }).waitFor();
      const layout = await inspectOverview(page);
      assert.equal(layout.panels, 4);
      assert.equal(layout.prioritySections, 0);
      assert.equal(layout.attentionLeftBorder, layout.attentionRightBorder);
      assert.ok(!layout.attentionBoxShadow.includes('inset'), '概览仍包含单边 inset 强调条');
      if (width <= 700) {
        assert.ok(Number.parseFloat(layout.gap) >= 12, `移动概览卡片间距过小：${layout.gap}`);
      }
      recordCheck(`${width} 概览没有灰色空洞或单边强调条`, layout);
      await assertNoRootOverflow(page, `${width} 概览无根页面横向溢出`);
      await screenshot(page, `overview-${width}.png`);
      await context.close();
    }

    assert.deepEqual(report.runtimeIssues, [], '发现 console/page/HTTP 错误');
    assert.deepEqual(report.failedRequests, [], '发现 request failure');
    assert.deepEqual(report.externalRequests, [], '发现外部请求');
    recordCheck('0 个 request failure、console/page/HTTP 错误和外部请求');
    report.result = 'PASS';
  } finally {
    await browser.close();
  }
}

run()
  .catch((error) => {
    report.result = 'FAIL';
    report.failure = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(outputDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });
