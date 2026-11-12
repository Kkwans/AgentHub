import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, initializeGitProject, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.describe.configure({ timeout: 120_000 });

type Identified = { id: string };
type Version = Identified & { contentHash: string };
type Task = Identified & {
  title: string;
  description: string;
  goalId: string;
  sessionId: string | null;
  status: string;
  promptVariablesJson: Record<string, unknown>;
};

for (const width of [1440, 1024, 768, 390]) {
  test(`新建工作固定 Prompt 版本并保留主目标与 Goal ${width}`, async ({
    page,
    context,
    app,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width, height: 1000 });
    const { project, agent } = await seedWorkspace(context, app);
    const goal = await apiData<Identified>(context, 'post', '/goals', {
      projectId: project.id,
      title: '保留所属目标',
    });
    const prompt = await apiData<Identified>(context, 'post', '/prompts', {
      projectId: project.id,
      key: 'e2e/new-work',
      name: '工作模板',
      kind: 'TASK',
      type: 'TEXT',
    });
    const version = await apiData<Version>(context, 'post', `/prompts/${prompt.id}/versions`, {
      content: { text: '固定旧版本：处理 {{ subject }}' },
      variables: {
        type: 'object',
        properties: { subject: { type: 'string' } },
        required: ['subject'],
      },
    });
    await page.goto(`/projects/${project.id}/work/new`);
    const dialog = page.getByRole('dialog', { name: '描述一项工作' });
    await dialog.getByRole('textbox', { name: '你想完成什么？' }).fill('主目标必须保留');
    await dialog.getByRole('textbox', { name: '补充上下文（可选）' }).fill('补充验收细节');
    await dialog.getByText('高级设置', { exact: true }).click();
    await dialog.getByRole('combobox', { name: '所属 Goal（可选）' }).click();
    await page.getByRole('option', { name: '保留所属目标' }).click();
    await dialog.getByRole('combobox', { name: 'PromptOS 资产（可选）' }).click();
    await page.getByRole('option', { name: /工作模板/ }).click();
    const create = dialog.getByRole('button', { name: '创建并开始', exact: true });
    await expect(create).toBeDisabled();
    await dialog
      .getByRole('textbox', { name: 'Prompt 变量（JSON 对象）' })
      .fill('{"subject":"登录回归"}');
    await dialog.getByRole('button', { name: '预览并固定版本' }).click();
    const preview = dialog.getByRole('region', { name: 'Prompt 预览' });
    await expect(preview).toContainText('已固定版本 v1');
    await expect(preview).toContainText('固定旧版本：处理 登录回归');
    // Publishing a newer version after preview must not change the selected version.
    await apiData(context, 'post', `/prompts/${prompt.id}/versions`, {
      content: { text: '错误的新版本内容' },
    });
    await expect(create).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`new-work-prompt-${width}.png`),
      fullPage: true,
    });
    await create.click();
    await expect(page).toHaveURL(/\/workspace\/[^/?]+$/);
    const sessionId = new URL(page.url()).pathname.split('/').at(-1)!;
    const tasks = await apiData<Task[]>(context, 'get', `/tasks?projectId=${project.id}`);
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task).toMatchObject({
      title: '主目标必须保留',
      description: '任务要求：\n主目标必须保留\n\n补充上下文：\n补充验收细节',
      goalId: goal.id,
      sessionId,
    });
    const bindings = await apiData<unknown[]>(
      context,
      'get',
      `/prompt-bindings?targetType=TASK&targetId=${task.id}`,
    );
    expect(bindings).toEqual([
      expect.objectContaining({
        promptId: prompt.id,
        versionId: version.id,
        selectorType: 'VERSION',
        slot: 'TASK_PRIMER',
      }),
    ]);
    const resolved = await apiData<{ finalContext: string; ready: boolean }>(
      context,
      'post',
      '/prompt-context/resolve',
      {
        projectId: project.id,
        taskId: task.id,
        agentId: agent.id,
        variables: { subject: '登录回归' },
      },
    );
    expect(resolved.ready).toBe(true);
    expect(resolved.finalContext).toContain('固定旧版本：处理 登录回归');
    expect(resolved.finalContext).not.toContain('错误的新版本内容');
    const runs = await apiData<Array<{ metadataJson: unknown }>>(
      context,
      'get',
      `/sessions/${sessionId}/runs`,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.metadataJson).toMatchObject({
      promptContext: {
        finalContextHash: createHash('sha256').update(resolved.finalContext).digest('hex'),
        items: [
          expect.objectContaining({
            promptId: prompt.id,
            versionId: version.id,
            contentHash: version.contentHash,
            targetType: 'TASK',
            targetId: task.id,
            slot: 'TASK_PRIMER',
          }),
        ],
      },
    });
    const messages = await apiData<Array<{ role: string; text: string }>>(
      context,
      'get',
      `/sessions/${sessionId}/messages`,
    );
    expect(
      messages.filter((message) => message.role === 'USER').map((message) => message.text),
    ).toEqual([
      '主目标必须保留\n\n任务说明：\n任务要求：\n主目标必须保留\n\n补充上下文：\n补充验收细节',
    ]);
    expect(errors).toEqual([]);
  });
}

test('没有 Agent 时保存模板版本与变量，稍后启动使用固定输入', async ({ page, context, app }) => {
  await initializeGitProject(app.projectRoot);
  const target = await apiData<Identified>(context, 'post', '/execution-targets', {
    name: '模板保存环境',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  const project = await apiData<Identified>(context, 'post', '/projects', {
    name: '模板保存项目',
    targetId: target.id,
    rootPath: app.projectRoot,
    kind: 'TEST',
  });
  const prompt = await apiData<Identified>(context, 'post', '/prompts', {
    projectId: project.id,
    key: 'e2e/template-only',
    name: '稍后启动模板',
    kind: 'TASK',
    type: 'TEXT',
  });
  const version = await apiData<Version>(context, 'post', `/prompts/${prompt.id}/versions`, {
    content: { text: '稍后执行旧模板：{{ subject }}' },
    variables: {
      type: 'object',
      properties: { subject: { type: 'string' } },
      required: ['subject'],
    },
  });
  await page.goto(`/projects/${project.id}/work/new`);
  const dialog = page.getByRole('dialog', { name: '描述一项工作' });
  await dialog.getByRole('textbox', { name: '你想完成什么？' }).fill('仅保存任务');
  await dialog.getByText('高级设置', { exact: true }).click();
  await dialog.getByRole('combobox', { name: 'PromptOS 资产（可选）' }).click();
  await page.getByRole('option', { name: /稍后启动模板/ }).click();
  await dialog
    .getByRole('textbox', { name: 'Prompt 变量（JSON 对象）' })
    .fill('{"subject":"稍后处理登录回归"}');
  await dialog.getByRole('button', { name: '预览并固定版本' }).click();
  await expect(dialog.getByRole('region', { name: 'Prompt 预览' })).toContainText(
    '保存模板版本与变量，稍后启动自动使用。',
  );
  await expect(dialog.getByRole('region', { name: 'Prompt 预览' })).toContainText(
    '稍后执行旧模板：稍后处理登录回归',
  );
  await apiData(context, 'post', `/prompts/${prompt.id}/versions`, {
    content: { text: '不应使用的新模板' },
  });
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/work\\?task=`));
  const tasks = await apiData<Task[]>(context, 'get', `/tasks?projectId=${project.id}`);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({
    title: '仅保存任务',
    status: 'BACKLOG',
    sessionId: null,
    promptVariablesJson: { subject: '稍后处理登录回归' },
  });
  const bindings = await apiData<unknown[]>(
    context,
    'get',
    `/prompt-bindings?targetType=TASK&targetId=${tasks[0]!.id}`,
  );
  expect(bindings).toEqual([
    expect.objectContaining({
      promptId: prompt.id,
      versionId: version.id,
      selectorType: 'VERSION',
    }),
  ]);
  expect(await apiData(context, 'get', `/sessions?projectId=${project.id}`)).toEqual([]);

  // A later start must consume the saved defaults without resubmitting variables.
  const agent = await apiData<Identified>(context, 'post', '/agents', {
    name: '稍后启动 Agent',
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
  const ready = await apiData<Task>(context, 'post', `/tasks/${tasks[0]!.id}/transition`, {
    status: 'READY',
  });
  expect(ready.status).toBe('READY');
  await apiData(context, 'post', `/tasks/${tasks[0]!.id}/start`, { agentId: agent.id });
  const started = await apiData<Task>(context, 'get', `/tasks/${tasks[0]!.id}`);
  expect(started.sessionId).toBeTruthy();
  expect(started.promptVariablesJson).toEqual({ subject: '稍后处理登录回归' });
  const resolved = await apiData<{ finalContext: string; ready: boolean }>(
    context,
    'post',
    '/prompt-context/resolve',
    {
      projectId: project.id,
      taskId: started.id,
      agentId: agent.id,
      variables: started.promptVariablesJson,
    },
  );
  expect(resolved.ready).toBe(true);
  expect(resolved.finalContext).toContain('稍后执行旧模板：稍后处理登录回归');
  expect(resolved.finalContext).not.toContain('不应使用的新模板');
  const runs = await apiData<Array<{ metadataJson: unknown }>>(
    context,
    'get',
    `/sessions/${started.sessionId}/runs`,
  );
  expect(runs).toHaveLength(1);
  expect(runs[0]?.metadataJson).toMatchObject({
    promptContext: {
      finalContextHash: createHash('sha256').update(resolved.finalContext).digest('hex'),
      items: [expect.objectContaining({ promptId: prompt.id, versionId: version.id })],
    },
  });
});

test('继承 Project Binding 时输入变量并直接启动，不创建显式 Task Binding', async ({
  page,
  context,
  app,
}) => {
  const { project, agent } = await seedWorkspace(context, app);
  const prompt = await apiData<Identified>(context, 'post', '/prompts', {
    projectId: project.id,
    key: 'e2e/inherited-variables',
    name: '项目继承模板',
    kind: 'TASK',
    type: 'TEXT',
  });
  const version = await apiData<Version>(context, 'post', `/prompts/${prompt.id}/versions`, {
    content: { text: '项目继承上下文：{{ subject }}' },
    variables: {
      type: 'object',
      properties: { subject: { type: 'string' } },
      required: ['subject'],
    },
  });
  await apiData(context, 'post', '/prompt-bindings', {
    targetType: 'PROJECT',
    targetId: project.id,
    slot: 'RULES',
    promptId: prompt.id,
    selectorType: 'VERSION',
    versionId: version.id,
  });
  await page.goto(`/projects/${project.id}/work/new`);
  const dialog = page.getByRole('dialog', { name: '描述一项工作' });
  await dialog.getByRole('textbox', { name: '你想完成什么？' }).fill('使用继承上下文');
  await dialog.getByText('高级设置', { exact: true }).click();
  await dialog
    .getByRole('textbox', { name: 'Prompt 变量（JSON 对象）' })
    .fill('{"subject":"继承登录回归"}');
  await expect(dialog.getByRole('button', { name: '预览并固定版本' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '创建并开始', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[^/?]+$/);
  const sessionId = new URL(page.url()).pathname.split('/').at(-1)!;
  const tasks = await apiData<Task[]>(context, 'get', `/tasks?projectId=${project.id}`);
  expect(tasks).toHaveLength(1);
  const task = tasks[0]!;
  expect(task).toMatchObject({ sessionId, promptVariablesJson: { subject: '继承登录回归' } });
  expect(
    await apiData(context, 'get', `/prompt-bindings?targetType=TASK&targetId=${task.id}`),
  ).toEqual([]);
  const resolved = await apiData<{ finalContext: string; ready: boolean }>(
    context,
    'post',
    '/prompt-context/resolve',
    {
      projectId: project.id,
      taskId: task.id,
      agentId: agent.id,
      variables: task.promptVariablesJson,
    },
  );
  expect(resolved.ready).toBe(true);
  expect(resolved.finalContext).toContain('项目继承上下文：继承登录回归');
  const runs = await apiData<Array<{ metadataJson: unknown }>>(
    context,
    'get',
    `/sessions/${sessionId}/runs`,
  );
  expect(runs).toHaveLength(1);
  expect(runs[0]?.metadataJson).toMatchObject({
    promptContext: {
      finalContextHash: createHash('sha256').update(resolved.finalContext).digest('hex'),
      items: [
        expect.objectContaining({
          promptId: prompt.id,
          versionId: version.id,
          targetType: 'PROJECT',
          targetId: project.id,
        }),
      ],
    },
  });
});
