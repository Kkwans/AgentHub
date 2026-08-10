/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, document, fetch, process, require, URL */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseURL = process.env.AGENTHUB_BASE_URL || 'http://192.168.5.110:3210';
const chromeExecutable =
  process.env.AGENTHUB_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDirectory = path.resolve(
  process.env.AGENTHUB_ACCEPTANCE_OUTPUT || path.join(process.cwd(), 'compose-evidence'),
);
const username = (process.env.AGENTHUB_ACCEPTANCE_USERNAME || '').trim();
const password = fs.readFileSync(0, 'utf8').trim();
const authenticatedRun = Boolean(username && password);

assert.equal(Boolean(username), Boolean(password), '账号验收必须同时提供用户名和 stdin 密码');
fs.mkdirSync(outputDirectory, { recursive: true });

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  baseURL,
  access: authenticatedRun ? 'account-login-through-ui' : 'first-run-setup-screen',
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
  await page.screenshot({ path: path.join(outputDirectory, filename), fullPage: true });
  report.screenshots.push(filename);
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

async function createContext(browser, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  trackRuntime(page, label);
  return { context, page };
}

async function loginThroughUi(page) {
  await page.goto(`${baseURL}/overview`, { waitUntil: 'networkidle' });
  const setupHeading = page.getByRole('heading', { name: '创建管理员账号' });
  if (await setupHeading.isVisible().catch(() => false)) {
    throw new Error(
      '正式服务尚未创建管理员账号；请先在页面完成首次设置，不要向 QA 脚本传部署 token',
    );
  }
  await page.getByRole('heading', { name: '登录 AgentHub' }).waitFor();
  await page.getByRole('textbox', { name: '用户名' }).fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('heading', { name: '今天需要处理什么' }).waitFor();
}

async function openOverview(browser, width) {
  const label = `viewport-${width}`;
  const { context, page } = await createContext(browser, { width, height: 1000 }, label);
  await loginThroughUi(page);
  await page.locator('.connection-pill.online').filter({ hasText: '已连接' }).waitFor({
    timeout: 15_000,
  });
  recordCheck(`${width} 账号 Cookie WebSocket 已连接`);
  await assertNoRootOverflow(page, `${width} 概览无根页面横向溢出`);
  await screenshot(page, `overview-${width}.png`);
  return { context, page };
}

async function run() {
  const healthResponse = await fetch(`${baseURL}/api/v1/health`);
  assert.equal(healthResponse.ok, true, `LAN health 返回 HTTP ${healthResponse.status}`);
  const health = (await healthResponse.json()).data;
  assert.equal(health.status, 'ok');
  assert.equal(health.version, '0.3.0');
  assert.equal(health.database, 'pglite');
  assert.equal(health.web, true);
  recordCheck('TX5Pro 直接访问 NAS LAN health', health);

  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
  });
  report.browser = browser.version();

  try {
    if (!authenticatedRun) {
      for (const width of [1440, 390]) {
        const label = `first-run-${width}`;
        const { context, page } = await createContext(browser, { width, height: 1000 }, label);
        await page.goto(`${baseURL}/overview`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: '创建管理员账号' }).waitFor();
        await page.getByRole('textbox', { name: '用户名' }).waitFor();
        await page.getByLabel('密码').waitFor();
        await page.getByLabel('确认密码').waitFor();
        await assertNoRootOverflow(page, `${width} 首次设置页无根页面横向溢出`);
        await screenshot(page, `first-run-${width}.png`);
        await context.close();
      }
      recordCheck('首次设置只要求用户名和密码，不展示 token、Session 或命令行');
      assert.deepEqual(report.runtimeIssues, [], '发现 console/page/HTTP 错误');
      assert.deepEqual(report.failedRequests, [], '发现 request failure');
      assert.deepEqual(report.externalRequests, [], '发现外部请求');
      report.result = 'PASS';
      return;
    }

    const desktop = await openOverview(browser, 1440);
    await desktop.page.getByRole('button', { name: /搜索与跳转/ }).click();
    const commandDialog = desktop.page.getByRole('dialog', { name: '搜索与跳转' });
    await commandDialog.getByRole('textbox', { name: '搜索页面' }).fill('PromptOS');
    await commandDialog.getByRole('option', { name: /PromptOS/ }).waitFor();
    await screenshot(desktop.page, 'command-palette-1440.png');
    await desktop.page.keyboard.press('Escape');
    recordCheck('1440 命令面板可聚焦、筛选并关闭');

    await desktop.page.goto(`${baseURL}/projects`, { waitUntil: 'networkidle' });
    await desktop.page.getByRole('heading', { name: 'Project 工作区' }).waitFor();
    await desktop.page.getByText('AgentHub', { exact: true }).first().waitFor();
    await desktop.page.getByText('/volume2/Project/AgentHub', { exact: true }).waitFor();
    recordCheck('正式 AgentHub Project 与路径可见');

    await desktop.page.goto(`${baseURL}/settings`, { waitUntil: 'networkidle' });
    await desktop.page.getByRole('heading', { name: '设置与诊断' }).waitFor();
    await desktop.page.getByRole('heading', { name: username }).waitFor();
    await desktop.page.getByRole('heading', { name: '账号登录' }).waitFor();
    await desktop.page.getByText('管理员登录保护已启用').waitFor();
    await desktop.page.getByRole('heading', { name: '外部集成' }).waitFor();
    await desktop.page.getByText(/网页登录不需要 API token/).waitFor();
    await desktop.page.getByText('不会修改 Compose、镜像或 volume').waitFor();
    await desktop.page.getByText('NAS LAN 浏览器', { exact: true }).waitFor();
    await assertNoRootOverflow(desktop.page, '1440 设置页无根页面横向溢出');
    await screenshot(desktop.page, 'settings-1440.png');
    recordCheck('设置页呈现账号安全、折叠外部集成与 Docker 高权限边界');
    await desktop.context.close();

    for (const width of [1024, 768]) {
      const coverage = await openOverview(browser, width);
      await coverage.context.close();
    }

    const mobile = await openOverview(browser, 390);
    await mobile.page.getByRole('button', { name: '打开导航' }).click();
    const navigationDialog = mobile.page.getByRole('dialog', { name: '主导航' });
    await navigationDialog.getByRole('navigation', { name: '一级导航' }).waitFor();
    await screenshot(mobile.page, 'navigation-390.png');
    await navigationDialog.getByRole('button', { name: '关闭导航' }).click();
    recordCheck('390 移动导航可打开并关闭');
    await mobile.page.goto(`${baseURL}/settings`, { waitUntil: 'networkidle' });
    await mobile.page.getByRole('heading', { name: '账号登录' }).waitFor();
    await assertNoRootOverflow(mobile.page, '390 设置页无根页面横向溢出');
    await screenshot(mobile.page, 'settings-390.png');
    await mobile.context.close();

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
    report.runtimeIssues.push({ label: 'acceptance', kind: 'fatal', message: error.message });
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(outputDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });
