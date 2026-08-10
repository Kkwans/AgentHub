/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, document, fetch, setTimeout, URL */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const playwrightPackage = process.env.AGENTHUB_PLAYWRIGHT_PACKAGE || 'playwright';
const { chromium } = require(playwrightPackage);

const baseURL = process.env.AGENTHUB_BASE_URL || 'http://127.0.0.1:43210';
const outputDirectory = path.resolve(
  process.env.AGENTHUB_ACCEPTANCE_OUTPUT || path.join(process.cwd(), 'artifacts'),
);
const projectRoot = process.env.AGENTHUB_PROJECT_ROOT || '/volume2/Project/AgentHub';
const expectedRemoteNodeName = process.env.AGENTHUB_EXPECT_REMOTE_NODE_NAME || '';
const executionTargetName = expectedRemoteNodeName || 'TX5Pro 验收宿主机';
const marker = 'TX5PRO_AGENTHUB_OK';
const startedAt = new Date().toISOString();

fs.mkdirSync(outputDirectory, { recursive: true });

const report = {
  schemaVersion: 1,
  startedAt,
  finishedAt: null,
  baseURL,
  projectRoot,
  expectedRemoteNodeName: expectedRemoteNodeName || null,
  browser: null,
  tunnel: null,
  checks: [],
  runtimeIssues: [],
  failedRequests: [],
  externalRequests: [],
  screenshots: [],
  result: 'RUNNING',
};

let tunnelProcess;

async function startTunnel() {
  const target = process.env.AGENTHUB_TUNNEL_TARGET;
  if (!target) return;

  const localPort = process.env.AGENTHUB_TUNNEL_LOCAL_PORT || '43210';
  const remotePort = process.env.AGENTHUB_TUNNEL_REMOTE_PORT || '3210';
  const stderr = [];
  tunnelProcess = spawn(
    'ssh.exe',
    [
      '-N',
      '-L',
      `${localPort}:127.0.0.1:${remotePort}`,
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      target,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  tunnelProcess.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (tunnelProcess.exitCode !== null) {
      throw new Error(`SSH 隧道提前退出：${stderr.join('').trim() || tunnelProcess.exitCode}`);
    }
    try {
      const response = await fetch(`${baseURL}/api/v1/health`);
      if (response.ok) {
        const health = await response.json();
        report.tunnel = {
          target,
          localPort: Number(localPort),
          remotePort: Number(remotePort),
          health: health.data,
        };
        recordCheck('TX5Pro 到 NAS 回环服务的 SSH 隧道健康');
        return;
      }
    } catch {
      // 隧道建立期间连接失败属于预期重试，不记录为页面运行时错误。
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`SSH 隧道在 20 秒内未通过健康检查：${stderr.join('').trim()}`);
}

async function stopTunnel() {
  if (!tunnelProcess || tunnelProcess.exitCode !== null) return;
  tunnelProcess.kill();
  await Promise.race([
    new Promise((resolve) => tunnelProcess.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (tunnelProcess.exitCode === null) tunnelProcess.kill('SIGKILL');
}

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
  const destination = path.join(outputDirectory, filename);
  await page.screenshot({ path: destination, fullPage: true });
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

async function waitForRealtime(page, name) {
  await page.locator('.connection-pill.online').filter({ hasText: '已连接' }).waitFor({
    timeout: 15_000,
  });
  recordCheck(name);
}

async function selectOptionContaining(select, text) {
  const option = select.locator('option').filter({ hasText: text }).first();
  const value = await option.getAttribute('value');
  assert.ok(value, `没有找到包含“${text}”的 select option`);
  await select.selectOption(value);
}

async function waitForApi(page, pathname, predicate, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    const response = await page.request.get(`${baseURL}${pathname}`);
    assert.equal(response.ok(), true, `${pathname} 返回 HTTP ${response.status()}`);
    latest = (await response.json()).data;
    if (predicate(latest)) return latest;
    await page.waitForTimeout(2_000);
  }
  throw new Error(
    `${pathname} 在 ${timeout}ms 内未达到预期状态；最后结果 ${JSON.stringify(latest)}`,
  );
}

async function runDesktopFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  trackRuntime(page, 'desktop-1440');

  await page.goto(`${baseURL}/overview`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '今天需要处理什么' }).waitFor();
  await waitForRealtime(page, '1440 全局 WebSocket 已连接');
  for (const label of ['概览', '项目', '任务', 'Agent', '会话', 'PromptOS', '设置']) {
    await page
      .getByRole('navigation', { name: '一级导航' })
      .getByText(label, { exact: true })
      .waitFor();
  }
  recordCheck('1440 概览与中文一级导航可用');
  await assertNoRootOverflow(page, '1440 概览无根页面横向溢出');

  if (expectedRemoteNodeName) {
    await page.getByRole('link', { name: '设置' }).click();
    await page.getByRole('heading', { name: 'Remote Node' }).waitFor();
    const remoteNodeCard = page.locator('.remote-node-card').filter({
      hasText: expectedRemoteNodeName,
    });
    await remoteNodeCard.waitFor();
    await remoteNodeCard.getByText('在线', { exact: true }).waitFor();
    await remoteNodeCard.getByText(projectRoot, { exact: true }).waitFor();
    await remoteNodeCard.getByText('Codex', { exact: true }).waitFor();
    await page.getByRole('button', { name: '生成一次性注册码' }).click();
    await page.getByRole('textbox', { name: '授权 roots' }).waitFor();
    await page.getByRole('button', { name: '取消' }).click();
    await assertNoRootOverflow(page, '1440 Remote Node 管理页无根页面横向溢出');
    await screenshot(page, 'remote-node-1440.png');
    recordCheck('TX5Pro 实机展示在线 Remote Node、授权 roots 与 Codex inventory');
  } else {
    await page.getByRole('link', { name: 'Agent' }).click();
    await page.getByRole('heading', { name: 'Agent 与执行目标' }).waitFor();
    await page.getByRole('button', { name: /注册 Execution Target/ }).click();
    const targetForm = page
      .locator('form.management-form')
      .filter({ hasText: '注册 Execution Target' });
    await targetForm.getByLabel('类型').selectOption('LOCAL_HOST');
    await targetForm.getByLabel('名称').fill(executionTargetName);
    await targetForm.getByLabel('hostname', { exact: true }).fill('DH4300Plus');
    await targetForm.getByLabel('os', { exact: true }).fill('linux');
    await targetForm.getByLabel('arch', { exact: true }).fill('arm64');
    await targetForm.getByRole('button', { name: '核验并注册' }).click();
    await page.locator('.target-row').filter({ hasText: executionTargetName }).waitFor();
    recordCheck('通过 UI 注册 LOCAL_HOST Execution Target');
  }

  await page.getByRole('link', { name: '项目' }).click();
  await page.getByRole('button', { name: /添加 Project/ }).click();
  const projectForm = page.locator('form.inline-form');
  await projectForm.getByLabel('名称').fill('AgentHub TX5Pro 验收');
  await projectForm.getByLabel('Project root').fill(projectRoot);
  await selectOptionContaining(projectForm.getByLabel('Execution Target'), executionTargetName);
  await projectForm.getByRole('button', { name: '预检并添加' }).click();
  await page.locator('.data-row').filter({ hasText: 'AgentHub TX5Pro 验收' }).waitFor();
  recordCheck(
    expectedRemoteNodeName
      ? '通过 UI 在 Remote Node 添加真实 Project 并完成预检'
      : '通过 UI 添加真实 NAS Project 并完成预检',
  );

  await page.getByRole('link', { name: 'Agent' }).click();
  await page.getByRole('button', { name: /添加 Agent/ }).click();
  const agentForm = page.locator('form.management-form').filter({ hasText: '添加内置 Agent' });
  await agentForm.getByLabel('Agent 类型').selectOption('CODEX');
  await agentForm.getByLabel('名称').fill('Codex TX5Pro 验收');
  await selectOptionContaining(agentForm.getByLabel('Execution Target'), executionTargetName);
  await agentForm.getByRole('button', { name: '添加 Agent' }).click();
  const agentRow = page.locator('.agent-row').filter({ hasText: 'Codex TX5Pro 验收' });
  await agentRow.waitFor();
  await agentRow.getByRole('button', { name: '重新预检' }).click();
  await agentRow.getByText('就绪', { exact: true }).waitFor({ timeout: 120_000 });
  recordCheck(
    expectedRemoteNodeName
      ? 'Remote Node Codex pinned adapter 真实 preflight 达到就绪'
      : 'Codex pinned adapter 真实 preflight 达到就绪',
  );

  await page.getByRole('link', { name: '任务' }).click();
  await page.getByRole('button', { name: /创建 Goal/ }).click();
  const goalForm = page.locator('form.task-create-form').filter({ hasText: 'Goal 标题' });
  await goalForm.getByLabel('Goal 标题').fill('TX5Pro 实机验收');
  await goalForm.getByLabel('说明').fill('验证浏览器到 NAS AgentHub 的真实工程闭环');
  await goalForm.getByLabel('成功标准').fill(`Agent 回复 ${marker} 且 Task 经人工确认完成`);
  await goalForm.getByRole('button', { name: '创建 Goal' }).click();
  await page.getByText('TX5Pro 实机验收', { exact: true }).waitFor();

  await page.getByRole('button', { name: /创建 Task/ }).click();
  const taskForm = page.locator('form.task-create-form').filter({ hasText: 'Task 标题' });
  await taskForm.getByLabel('Task 标题').fill('TX5Pro 真实 Agent 链路');
  await taskForm.getByLabel('所属 Goal').selectOption({ label: 'TX5Pro 实机验收' });
  const taskInputs = taskForm
    .locator('label')
    .filter({ hasText: '任务与验收标准' })
    .locator('input');
  await taskInputs.nth(0).fill(`只回复：${marker}，不要调用任何工具。`);
  await taskInputs.nth(1).fill(`回复必须包含 ${marker}`);
  await taskForm.getByRole('button', { name: '创建 Task' }).click();
  const taskCard = page.locator('.task-card').filter({ hasText: 'TX5Pro 真实 Agent 链路' });
  await taskCard.getByRole('button', { name: '设为就绪' }).click();
  await selectOptionContaining(taskCard.getByLabel('Agent'), 'Codex TX5Pro 验收');
  await taskCard.getByRole('button', { name: /直接运行/ }).click();
  await page.waitForURL(/\/sessions\//, { timeout: 30_000 });
  recordCheck('通过 UI 创建 Goal、Task 并交给 Codex Agent');

  await page.locator('.message.user .message-body').filter({ hasText: marker }).waitFor();
  await page.locator('.message.assistant .message-body').filter({ hasText: marker }).waitFor({
    timeout: 180_000,
  });
  const sessionId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  assert.ok(sessionId, '无法从 Workspace URL 解析 Session ID');
  const runs = await waitForApi(page, `/api/v1/sessions/${sessionId}/runs`, (entries) =>
    entries.some((run) => run.status === 'COMPLETED'),
  );
  assert.equal(
    runs.some((run) => run.status === 'FAILED'),
    false,
    '真实 Run 出现失败状态',
  );
  await page.getByText('AgentHub TX5Pro 验收', { exact: true }).first().waitFor();
  await page
    .locator('.session-list a.current .status-badge')
    .getByText('就绪', { exact: true })
    .waitFor();
  recordCheck(
    expectedRemoteNodeName
      ? 'Remote Node 真实 Codex Session 流式响应并完成 Run'
      : '真实 Codex Session 流式响应并完成 Run',
    { sessionId },
  );
  await screenshot(page, 'workspace-1440.png');

  await page.getByRole('link', { name: '任务' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  const reviewCard = page.locator('.task-card').filter({ hasText: 'TX5Pro 真实 Agent 链路' });
  await reviewCard.getByText('待审阅', { exact: true }).waitFor({ timeout: 30_000 });
  await reviewCard.getByRole('button', { name: /确认完成/ }).click();
  await reviewCard.getByText('完成', { exact: true }).waitFor();
  recordCheck('Run 完成后进入待审阅并由用户确认完成');
  await screenshot(page, 'tasks-done-1440.png');

  await page.getByRole('link', { name: 'PromptOS' }).click();
  await page.getByRole('heading', { name: 'PromptOS', exact: true, level: 2 }).waitFor();
  recordCheck('PromptOS 中文管理页可访问');

  await page.getByRole('link', { name: '设置' }).click();
  await page.getByRole('heading', { name: '设置与诊断' }).waitFor();
  await page.getByRole('heading', { name: 'Terminal' }).waitFor();
  await page.getByText('不会修改 Compose、镜像或 volume').waitFor();
  await page.getByText('loopback 默认模式').waitFor();
  if (expectedRemoteNodeName) {
    await page.locator('.remote-node-card').filter({ hasText: expectedRemoteNodeName }).waitFor();
  }
  await assertNoRootOverflow(page, '1440 设置页无根页面横向溢出');
  recordCheck('设置页呈现 Terminal、认证与 Docker 安全边界');

  await context.close();
  return { sessionId };
}

async function runExistingSessionCoverage(browser, sessionId) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  trackRuntime(page, 'desktop-1440-existing');

  await page.goto(`${baseURL}/promptos`, { waitUntil: 'networkidle' });
  await waitForRealtime(page, '复用 Session 覆盖时全局 WebSocket 已连接');
  await page.getByRole('heading', { name: 'PromptOS', exact: true, level: 2 }).waitFor();
  recordCheck('PromptOS 中文管理页可访问');

  await page.getByRole('link', { name: '设置' }).click();
  await page.getByRole('heading', { name: '设置与诊断' }).waitFor();
  await page.getByRole('heading', { name: 'Terminal' }).waitFor();
  await page.getByText('不会修改 Compose、镜像或 volume').waitFor();
  await page.getByText('loopback 默认模式').waitFor();
  await assertNoRootOverflow(page, '1440 设置页无根页面横向溢出');
  recordCheck('设置页呈现 Terminal、认证与 Docker 安全边界');

  await page.goto(`${baseURL}/sessions/${sessionId}`, { waitUntil: 'networkidle' });
  await page.locator('.message.assistant .message-body').filter({ hasText: marker }).waitFor();
  await context.close();
  return { sessionId };
}

async function runResponsive(browser, sessionId) {
  const viewports = [
    { name: 'desktop-1024', width: 1024, height: 900 },
    { name: 'tablet-768', width: 768, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.width === 390,
      hasTouch: viewport.width === 390,
    });
    const page = await context.newPage();
    trackRuntime(page, viewport.name);
    await page.goto(`${baseURL}/overview`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '今天需要处理什么' }).waitFor();
    await waitForRealtime(page, `${viewport.width} 全局 WebSocket 已连接`);
    await assertNoRootOverflow(page, `${viewport.width} 概览无根页面横向溢出`);
    await screenshot(page, `overview-${viewport.width}.png`);

    await page.goto(`${baseURL}/sessions/${sessionId}`, { waitUntil: 'networkidle' });
    await page.locator('.message.assistant .message-body').filter({ hasText: marker }).waitFor();
    if (viewport.width <= 768) {
      await page.getByRole('tab', { name: '运行' }).waitFor();
      await page.getByRole('tab', { name: '运行' }).click();
      await page.getByRole('button', { name: '关闭检查器' }).waitFor();
      if (viewport.width === 768) {
        await page.getByRole('button', { name: '关闭检查器' }).click({ position: { x: 8, y: 8 } });
      } else {
        await page.getByRole('tab', { name: '对话' }).click();
      }
      await page.getByRole('tab', { name: '对话' }).waitFor();
    }
    await assertNoRootOverflow(page, `${viewport.width} Workspace 无根页面横向溢出`);
    await screenshot(page, `workspace-${viewport.width}.png`);

    if (viewport.width === 390) {
      await page.getByRole('button', { name: '打开导航' }).click();
      await page.getByRole('navigation', { name: '一级导航' }).waitFor();
      await page.getByRole('link', { name: '设置' }).click();
      await page.getByRole('heading', { name: '设置与诊断' }).waitFor();
      if (expectedRemoteNodeName) {
        await page
          .locator('.remote-node-card')
          .filter({ hasText: expectedRemoteNodeName })
          .waitFor();
      }
      await page.waitForTimeout(250);
      const sidebarClosed = await page.locator('.sidebar').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return !element.classList.contains('is-open') && bounds.right <= 1;
      });
      assert.equal(sidebarClosed, true, '390 导航到设置后侧栏没有完全关闭');
      await assertNoRootOverflow(page, '390 移动导航与设置页无根页面横向溢出');
      await screenshot(page, 'settings-390.png');
      recordCheck('390 移动导航、Workspace tabs 与检查器 drawer 可用');
    }

    await context.close();
  }
}

async function main() {
  let browser;
  try {
    await startTunnel();
    browser = await chromium.launch({
      channel: process.env.AGENTHUB_BROWSER_CHANNEL || 'chrome',
      headless: true,
    });
    report.browser = await browser.version();
    const existingSessionId = process.env.AGENTHUB_EXISTING_SESSION_ID;
    const { sessionId } = existingSessionId
      ? await runExistingSessionCoverage(browser, existingSessionId)
      : await runDesktopFlow(browser);
    await runResponsive(browser, sessionId);

    assert.deepEqual(report.failedRequests, [], '存在浏览器请求失败');
    assert.deepEqual(report.runtimeIssues, [], '存在页面运行时、console 或 HTTP 错误');
    assert.deepEqual(report.externalRequests, [], '页面发起了非 AgentHub 外部请求');
    recordCheck('无 requestfailed、console error、pageerror、HTTP 4xx/5xx 或外部请求');
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL';
    report.error =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack || ''}`
        : String(error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopTunnel();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(outputDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(`REPORT ${path.join(outputDirectory, 'report.json')}`);
  }
}

void main();
