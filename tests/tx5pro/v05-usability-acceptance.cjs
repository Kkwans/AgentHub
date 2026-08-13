/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, document, fetch, process, require, setTimeout, URL */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const playwrightPackage = process.env.AGENTHUB_PLAYWRIGHT_PACKAGE || 'playwright';
const { chromium } = require(playwrightPackage);

const baseURL = process.env.AGENTHUB_BASE_URL || 'http://127.0.0.1:43210';
const projectRoot = requiredEnvironment('AGENTHUB_PROJECT_ROOT');
const fixtureAgentPath = requiredEnvironment('AGENTHUB_FIXTURE_AGENT_PATH');
const fixtureNodePath = requiredEnvironment('AGENTHUB_FIXTURE_NODE_PATH');
const outputDirectory = path.resolve(
  process.env.AGENTHUB_ACCEPTANCE_OUTPUT || path.join(process.cwd(), 'v05-evidence'),
);
const chromeExecutable =
  process.env.AGENTHUB_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const username = 'qa5';
const password = '123456';
const names = {
  target: 'TX5Pro v0.5 宿主机',
  project: 'TX5Pro v0.5 Project',
  fixtureAgent: 'TX5Pro ACP Fixture',
  codexAgent: 'TX5Pro Codex',
  goal: 'TX5Pro v0.5 可用性闭环',
  task: 'TX5Pro Approval 与 Git 闭环',
  promptKey: 'tx5/v05-task-guidance',
  promptName: 'TX5Pro v0.5 任务指令',
};

fs.mkdirSync(outputDirectory, { recursive: true });

const report = {
  schemaVersion: 2,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  baseURL,
  access: 'ephemeral-account-login-through-ui',
  projectRoot,
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

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `缺少环境变量 ${name}`);
  return value;
}

function recordCheck(name, details = {}) {
  report.checks.push({ name, status: 'PASS', ...details });
  console.log(`PASS ${name}`);
}

async function startTunnel() {
  const target = requiredEnvironment('AGENTHUB_TUNNEL_TARGET');
  const localPort = process.env.AGENTHUB_TUNNEL_LOCAL_PORT || '43210';
  const remotePort = process.env.AGENTHUB_TUNNEL_REMOTE_PORT || '3220';
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
        recordCheck('TX5Pro 到 NAS 隔离实例的 SSH 隧道健康');
        return;
      }
    } catch {
      // 隧道建立期间的连接失败属于预期重试。
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

async function waitForRealtime(page, name) {
  await page.getByRole('status', { name: '实时连接已连接' }).waitFor({ timeout: 15_000 });
  recordCheck(name);
}

function navigationLink(page, name) {
  return page
    .getByRole('navigation', { name: '一级导航' })
    .getByRole('link', { name, exact: true });
}

async function selectOptionContaining(select, text) {
  const option = select.locator('option').filter({ hasText: text }).first();
  const value = await option.getAttribute('value');
  assert.ok(value, `没有找到包含“${text}”的 select option`);
  await select.selectOption(value);
}

async function api(context, method, pathname, data) {
  const response = await context.request[method](`${baseURL}/api/v1${pathname}`, {
    ...(data ? { data } : {}),
  });
  assert.equal(
    response.ok(),
    true,
    `${method.toUpperCase()} ${pathname} 返回 ${response.status()}`,
  );
  return (await response.json()).data;
}

async function runJourney(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  trackRuntime(page, 'journey-1440');

  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '创建管理员账号' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /显示密码|隐藏密码/ }).count(), 2);
  assert.equal(
    await page.getByLabel('确认密码').locator('xpath=..').getByRole('button').count(),
    1,
  );
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码').fill(password);
  await screenshot(page, 'account-setup-1440.png');
  await page.getByRole('button', { name: '创建账号并进入' }).click();
  await page.getByRole('heading', { name: '今天需要处理什么' }).waitFor();
  await waitForRealtime(page, '首次设置后 Cookie 与 WebSocket 已连接');
  recordCheck('普通用户仅用三字符用户名和六字符密码完成首次设置');

  await navigationLink(page, 'Agent').click();
  await page.getByRole('button', { name: /注册 Execution Target/ }).click();
  const targetForm = page
    .locator('form.management-form')
    .filter({ hasText: '注册 Execution Target' });
  await targetForm.getByLabel('类型').selectOption('LOCAL_HOST');
  await targetForm.getByLabel('名称').fill(names.target);
  await targetForm.getByLabel('hostname', { exact: true }).fill('DH4300Plus');
  await targetForm.getByLabel('os', { exact: true }).fill('linux');
  await targetForm.getByLabel('arch', { exact: true }).fill('arm64');
  await targetForm.getByRole('button', { name: '核验并注册' }).click();
  await page.locator('.target-row').filter({ hasText: names.target }).waitFor();

  await navigationLink(page, '项目').click();
  await page.getByRole('button', { name: /添加 Project/ }).click();
  const projectForm = page.locator('form.inline-form');
  await projectForm.getByLabel('名称').fill(names.project);
  await projectForm.getByLabel('Project root').fill(projectRoot);
  await selectOptionContaining(projectForm.getByLabel('Execution Target'), names.target);
  await projectForm.getByRole('button', { name: '预检并添加' }).click();
  const projectRow = page.locator('.project-row').filter({ hasText: names.project });
  await projectRow.waitFor();
  await projectRow.getByText('使用中', { exact: true }).waitFor();
  recordCheck('通过 UI 注册宿主机 Execution Target 与隔离 Git Project');

  const targets = await api(context, 'get', '/execution-targets');
  const target = targets.find((entry) => entry.name === names.target);
  assert.ok(target?.id, '没有找到 UI 创建的 Execution Target');
  const projects = await api(context, 'get', '/projects');
  const project = projects.find((entry) => entry.name === names.project);
  assert.ok(project?.id, '没有找到 UI 创建的 Project');
  const fixtureAgent = await api(context, 'post', '/agents', {
    name: names.fixtureAgent,
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: fixtureNodePath,
    args: [fixtureAgentPath, '--write-fixture'],
  });
  const fixturePreflight = await api(context, 'post', `/agents/${fixtureAgent.id}/preflight`, {
    cwd: projectRoot,
  });
  assert.equal(fixturePreflight.status, 'READY');

  await navigationLink(page, 'Agent').click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(names.fixtureAgent, { exact: true }).waitFor();
  await page.getByRole('button', { name: /添加 Agent/ }).click();
  const agentForm = page.locator('form.management-form').filter({ hasText: '添加内置 Agent' });
  await agentForm.getByLabel('Agent 类型').selectOption('CODEX');
  await agentForm.getByLabel('名称').fill(names.codexAgent);
  await selectOptionContaining(agentForm.getByLabel('Execution Target'), names.target);
  await agentForm.getByRole('button', { name: '添加 Agent' }).click();
  const codexRow = page.locator('.agent-row').filter({ hasText: names.codexAgent });
  await codexRow.waitFor();
  await codexRow.getByRole('button', { name: '重新预检' }).click();
  await codexRow.getByText('就绪', { exact: true }).waitFor({ timeout: 120_000 });
  recordCheck('通过 UI 添加 pinned Codex 并完成真实 preflight');
  await screenshot(page, 'agents-ready-1440.png');

  await navigationLink(page, '任务').click();
  await page.getByRole('button', { name: /创建 Goal/ }).click();
  const goalForm = page
    .locator('form.task-create-form')
    .filter({ has: page.getByLabel('Goal 标题') });
  await goalForm.getByLabel('Goal 标题').fill(names.goal);
  await goalForm.getByLabel('说明').fill('验证普通用户从 PromptOS 到 Task 审阅的真实闭环');
  await goalForm.getByLabel('成功标准').fill('Approval、文件、Git 与人工审阅证据完整');
  await goalForm.getByRole('button', { name: '创建 Goal' }).click();
  await page.getByText(names.goal, { exact: true }).waitFor();

  await page.getByRole('button', { name: /创建 Task/ }).click();
  const taskForm = page
    .locator('form.task-create-form')
    .filter({ has: page.getByLabel('Task 标题') });
  await taskForm.getByLabel('Task 标题').fill(names.task);
  await taskForm.getByLabel('所属 Goal').selectOption({ label: names.goal });
  await taskForm.getByPlaceholder('Agent 要完成的工作').fill('通过真实 ACP 写入 fixture-output.md');
  await taskForm.getByPlaceholder('验收标准').fill('Approval 已交付、Git 已提交且最终 Run 完成');
  await taskForm.getByRole('button', { name: '创建 Task' }).click();
  let taskCard = page.locator('.task-card').filter({ hasText: names.task });
  await taskCard.waitFor();

  const tasks = await api(context, 'get', `/tasks?projectId=${project.id}`);
  const task = tasks.find((entry) => entry.title === names.task);
  assert.ok(task?.id, '没有找到 UI 创建的 Task');

  await navigationLink(page, 'PromptOS').click();
  await page.getByRole('button', { name: '新建 Prompt' }).click();
  const promptForm = page.locator('form.management-form').filter({ has: page.getByLabel('key') });
  await promptForm.getByLabel('key').fill(names.promptKey);
  await promptForm.getByLabel('名称').fill(names.promptName);
  await promptForm.getByLabel('Project 范围').selectOption({ label: names.project });
  await promptForm.getByLabel('说明').fill('TX5Pro v0.5 可用性验收');
  await promptForm.getByRole('button', { name: '创建 Prompt 标识' }).click();
  const versionForm = page.locator('form.version-form');
  await versionForm
    .locator('textarea[name="content"]')
    .fill('执行 TX5Pro v0.5 Task，并保留 Git 证据。');
  await versionForm.getByLabel('变更说明').fill('创建 TX5Pro v0.5 验收版本');
  await versionForm.getByRole('button', { name: '创建新版本' }).click();
  await page.locator('.version-list').getByText('v1', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '绑定' }).click();
  const bindingForm = page.locator('form.binding-form');
  await bindingForm.getByLabel('目标类型').selectOption('TASK');
  await bindingForm.getByLabel('Project 范围').selectOption({ label: names.project });
  await bindingForm
    .locator('select[name="targetId"]')
    .selectOption({ label: `${names.task} · BACKLOG` });
  await bindingForm.getByLabel('Slot').selectOption('TASK_PRIMER');
  await bindingForm.getByRole('button', { name: '创建绑定' }).click();
  await page.locator('.binding-list').getByText(names.task, { exact: true }).waitFor();
  await page.getByRole('tab', { name: '渲染演练' }).click();
  await page.getByRole('button', { name: '渲染' }).click();
  await page.getByText('变量完整').waitFor();
  recordCheck('通过 UI 创建 Prompt v1、Task Binding 并完成本地渲染');
  await screenshot(page, 'promptos-binding-1440.png');

  await navigationLink(page, '任务').click();
  taskCard = page.locator('.task-card').filter({ hasText: names.task });
  await taskCard.getByRole('button', { name: '设为就绪' }).click();
  await taskCard.getByText('就绪', { exact: true }).waitFor();
  await selectOptionContaining(taskCard.getByLabel('Agent'), names.fixtureAgent);
  await taskCard.getByRole('button', { name: /直接运行/ }).click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]+$/, { timeout: 30_000 });
  const sessionId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  assert.ok(sessionId, '无法从 Workspace URL 解析 Session ID');
  await page.locator('.composer-context').getByText(names.fixtureAgent, { exact: true }).waitFor();
  const promptContext = page.locator('.composer-context button').filter({ hasText: 'PromptOS' });
  await promptContext.getByText('1 项', { exact: true }).waitFor();
  await promptContext.click();
  await page.getByText(`${names.promptKey}@latest`, { exact: true }).waitFor();
  await page.getByRole('button', { name: '允许一次' }).waitFor({ timeout: 15_000 });
  const approvals = await api(context, 'get', `/approvals?sessionId=${sessionId}`);
  const approval = approvals.find((entry) => entry.status === 'PENDING');
  assert.ok(approval?.id, '没有找到待处理 Approval');
  await screenshot(page, 'approval-pending-1440.png');
  await page.getByRole('button', { name: '允许一次' }).click();
  await page.getByText('Fixture 已完成').waitFor({ timeout: 15_000 });
  await page.getByText('没有活动 Run').waitFor({ timeout: 15_000 });
  recordCheck('真实 ACP 子进程完成 Approval 并写入 fixture-output.md');

  await page.getByRole('tab', { name: 'Git' }).click();
  await page.getByLabel('选择 fixture-output.md').waitFor({ timeout: 15_000 });
  await page.getByLabel('选择 fixture-output.md').check();
  const commitForm = page.locator('form.git-commit-form');
  await commitForm.getByLabel('提交说明').fill('test: 提交 TX5Pro v0.5 ACP 输出');
  await commitForm.getByRole('button', { name: '提交所选文件 (1)' }).click();
  await page.locator('.git-inspector').getByRole('status').filter({ hasText: '提交完成' }).waitFor({
    timeout: 15_000,
  });
  recordCheck('通过 Workspace Git 面板选择文件并创建提交');
  await screenshot(page, 'workspace-git-1440.png');

  await navigationLink(page, '任务').click();
  taskCard = page.locator('.task-card').filter({ hasText: names.task });
  await taskCard.getByText('待审阅', { exact: true }).waitFor({ timeout: 15_000 });
  await taskCard.getByRole('button', { name: '审阅结果' }).click();
  const reviewDialog = page.getByRole('dialog');
  await reviewDialog.getByRole('heading', { name: names.task }).waitFor();
  await reviewDialog.getByText('Approval 已交付、Git 已提交且最终 Run 完成').waitFor();
  await reviewDialog.getByText('当前 Git 现场').waitFor();
  await reviewDialog.getByText('0 个路径').waitFor();
  await reviewDialog.getByRole('button', { name: '确认达到验收标准' }).click();
  await taskCard.getByText('完成', { exact: true }).waitFor();
  recordCheck('Run 完成后进入待审阅，用户查看证据后确认 Task 完成');
  await screenshot(page, 'task-done-1440.png');

  const persistedTask = await api(context, 'get', `/tasks/${task.id}`);
  const persistedApproval = await api(context, 'get', `/approvals/${approval.id}`);
  const commits = await api(context, 'get', `/projects/${project.id}/git/commits?limit=10`);
  assert.equal(persistedTask.status, 'DONE');
  assert.equal(persistedApproval.status, 'APPROVED');
  assert.equal(persistedApproval.selectedOptionId, 'allow-once');
  assert.equal(persistedApproval.deliveryState, 'DELIVERED');
  assert.ok(commits.some((entry) => entry.subject === 'test: 提交 TX5Pro v0.5 ACP 输出'));
  recordCheck('API 持久化状态与 UI 旅程一致');

  await navigationLink(page, '设置').click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByRole('heading', { name: '登录 AgentHub' }).waitFor();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('heading', { name: '设置与诊断' }).waitFor();
  recordCheck('退出后仅凭账号密码恢复原页面与管理员会话');

  const storageState = await context.storageState();
  await context.close();
  return { sessionId, storageState };
}

async function runResponsive(browser, sessionId, storageState) {
  const viewports = [
    { name: 'desktop-1024', width: 1024, height: 900 },
    { name: 'tablet-768', width: 768, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
  ];
  const routes = [
    { name: 'overview', path: '/overview', heading: '今天需要处理什么' },
    { name: 'tasks', path: '/tasks', heading: 'Goal 与 Task' },
    { name: 'promptos', path: '/promptos', heading: 'PromptOS' },
    { name: 'workspace', path: `/sessions/${sessionId}`, selector: '.workspace-shell' },
    { name: 'settings', path: '/settings', heading: '设置与诊断' },
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.width === 390,
      hasTouch: viewport.width === 390,
      storageState,
    });
    const page = await context.newPage();
    trackRuntime(page, viewport.name);
    for (const route of routes) {
      await page.goto(`${baseURL}${route.path}`, { waitUntil: 'networkidle' });
      if (route.selector) {
        await page.locator(route.selector).waitFor();
      } else {
        await page.getByRole('heading', { name: route.heading }).first().waitFor();
      }
      await assertNoRootOverflow(page, `${viewport.width} ${route.name} 无根页面横向溢出`);
      await screenshot(page, `${route.name}-${viewport.width}.png`);
      if (route.name === 'workspace' && viewport.width <= 768) {
        await page.getByRole('tab', { name: 'Git' }).click();
        await page.getByRole('button', { name: '关闭检查器' }).waitFor();
        await screenshot(page, `workspace-git-drawer-${viewport.width}.png`);
        await page.getByRole('button', { name: '关闭检查器' }).click();
      }
    }
    await waitForRealtime(page, `${viewport.width} 全局 WebSocket 已连接`);
    if (viewport.width === 390) {
      await page.getByRole('button', { name: '打开导航' }).click();
      await page.getByRole('navigation', { name: '一级导航' }).waitFor();
      await screenshot(page, 'navigation-390.png');
      recordCheck('390 触控视口的移动导航可用');
    }
    await context.close();
  }
}

async function main() {
  let browser;
  try {
    await startTunnel();
    browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
    report.browser = await browser.version();
    const { sessionId, storageState } = await runJourney(browser);
    await runResponsive(browser, sessionId, storageState);
    assert.deepEqual(report.failedRequests, [], '存在浏览器请求失败');
    assert.deepEqual(report.runtimeIssues, [], '存在页面运行时、console 或 HTTP 错误');
    assert.deepEqual(report.externalRequests, [], '页面发起了非 AgentHub 外部请求');
    recordCheck('0 request failure、0 console/page error、0 HTTP 4xx/5xx、0 外部请求');
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
