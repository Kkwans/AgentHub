import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  PromptRepository,
  SkillRepository,
  tasks,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PromptService } from './prompt-service.js';

describe('PromptOS service', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let service: PromptService;
  let projectId: string;
  let agentId: string;
  let projectRoot: string;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const agents = new AgentRepository(database.db);
    const targetId = randomUUID();
    projectId = randomUUID();
    agentId = randomUUID();
    projectRoot = await mkdtemp(join(tmpdir(), 'agenthub-promptos-'));
    await targets.create({
      id: targetId,
      name: '本地测试',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await projects.create({
      id: projectId,
      name: 'PromptOS 测试',
      targetId,
      rootPath: projectRoot,
      realRootPath: projectRoot,
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    await agents.create({
      id: agentId,
      targetId,
      name: 'Fake Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    service = new PromptService(
      new PromptRepository(database.db),
      new SkillRepository(database.db),
      projects,
    );
  });

  afterAll(async () => {
    await database.close();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('创建 immutable Version、维护 latest、移动 production 并 render/Diff', async () => {
    const prompt = await service.create({
      projectId,
      key: 'review/safe-change',
      name: '安全审阅',
      kind: 'REVIEW',
      type: 'TEXT',
    });
    const variables = {
      type: 'object',
      properties: { 'task.name': { type: 'string' } },
      required: ['task.name'],
    };
    const version1 = await service.createVersion(prompt.id, {
      content: { text: '审阅 {{ task.name }}，确保变更安全。' },
      variables,
      changelog: '初始版本',
    });
    const version2 = await service.createVersion(prompt.id, {
      content: { text: '深入审阅 {{ task.name }}，确保变更安全且可回滚。' },
      variables,
      changelog: '增加回滚要求',
    });

    expect(
      (await service.listLabels(prompt.id)).find((label) => label.label === 'latest'),
    ).toMatchObject({ version: 2 });
    await expect(service.moveLabel(prompt.id, 'latest', version1.id)).rejects.toMatchObject({
      code: 'PROMPT_LATEST_LABEL_MANAGED',
    });
    await expect(service.deleteLabel(prompt.id, 'latest')).rejects.toMatchObject({
      code: 'PROMPT_LATEST_LABEL_MANAGED',
    });
    await service.moveLabel(prompt.id, 'production', version1.id);

    const missing = await service.render(prompt.id, { label: 'production', variables: {} });
    expect(missing.missingVariables).toEqual(['task.name']);
    const rendered = await service.render(prompt.id, {
      label: 'production',
      variables: { task: { name: '迁移认证模块' } },
    });
    expect(rendered).toMatchObject({ version: 1, label: 'production', missingVariables: [] });
    expect(rendered.text).toContain('迁移认证模块');
    expect((await service.diff(prompt.id, 1, 2)).patch).toContain('+深入审阅');
    expect(version2.contentHash).not.toBe(version1.contentHash);
  });

  it('按 Project → Agent 和同 slot priority 解析并返回完整 provenance', async () => {
    const [prompt] = await service.list(projectId);
    if (!prompt) throw new Error('缺少测试 Prompt');
    const versions = await service.listVersions(prompt.id);
    const version2 = versions.find((version) => version.version === 2);
    if (!version2) throw new Error('缺少 Version 2');
    await service.createBinding({
      targetType: 'PROJECT',
      targetId: projectId,
      slot: 'REVIEW',
      promptId: prompt.id,
      selectorType: 'LABEL',
      label: 'production',
      priority: 10,
    });
    await service.createBinding({
      targetType: 'AGENT',
      targetId: agentId,
      slot: 'REVIEW',
      promptId: prompt.id,
      selectorType: 'VERSION',
      versionId: version2.id,
      priority: 5,
    });

    const missing = await service.resolve({ projectId, agentId, variables: {} });
    expect(missing.ready).toBe(false);
    expect(missing.missingVariables).toEqual(['task.name']);

    const resolved = await service.resolve({
      projectId,
      agentId,
      variables: { task: { name: 'AgentHub' } },
    });
    expect(resolved.ready).toBe(true);
    expect(resolved.items.map((item) => [item.targetType, item.version])).toEqual([
      ['PROJECT', 1],
      ['AGENT', 2],
    ]);
    expect(resolved.items.every((item) => item.contentHash.length === 64)).toBe(true);
    expect(resolved.finalContext).toContain('PromptOS REVIEW');
  });

  it('CHAT Diff 保留 role/message 结构', async () => {
    const prompt = await service.create({
      key: `chat-${randomUUID()}`,
      name: '对话模板',
      kind: 'SYSTEM',
      type: 'CHAT',
    });
    await service.createVersion(prompt.id, {
      content: { messages: [{ role: 'system', content: '保持简洁' }] },
    });
    await service.createVersion(prompt.id, {
      content: {
        messages: [
          { role: 'system', content: '保持简洁并说明证据' },
          { role: 'user', content: '{{ task }}' },
        ],
      },
      variables: {
        type: 'object',
        properties: { task: { type: 'string' } },
        required: ['task'],
      },
    });
    const diff = await service.diff(prompt.id, 1, 2);
    expect(diff.type).toBe('CHAT');
    expect(diff.patch).toContain('"role": "user"');
  });

  it('只扫描 Project 内 Skill metadata，不复制原生指令文件', async () => {
    const skillRoot = join(projectRoot, '.agents/skills/release-check');
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, 'SKILL.md'),
      '---\nname: 发布检查\ndescription: 验证发布门禁\n---\n\n# 发布检查\n',
      'utf8',
    );
    await writeFile(join(projectRoot, 'AGENTS.md'), '# 不应导入\n', 'utf8');

    const scanned = await service.scanSkills(projectId);
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toMatchObject({
      slug: 'release-check',
      name: '发布检查',
      source: 'PROJECT_SCAN',
    });
    expect((await service.listSkills(projectId)).some((skill) => skill.slug === 'AGENTS.md')).toBe(
      false,
    );
  });

  it('Task binding 只接受真实 target', async () => {
    const taskId = randomUUID();
    await database.db.insert(tasks).values({
      id: taskId,
      projectId,
      title: '真实 Task',
      status: 'BACKLOG',
    });
    const [prompt] = await service.list(projectId);
    const [version] = prompt ? await service.listVersions(prompt.id) : [];
    if (!prompt || !version) throw new Error('缺少 Prompt fixture');
    await expect(
      service.createBinding({
        targetType: 'TASK',
        targetId: randomUUID(),
        slot: 'RULES',
        promptId: prompt.id,
        selectorType: 'VERSION',
        versionId: version.id,
      }),
    ).rejects.toMatchObject({ code: 'PROMPT_BINDING_TARGET_NOT_FOUND' });
    await expect(
      service.createBinding({
        targetType: 'TASK',
        targetId: taskId,
        slot: 'RULES',
        promptId: prompt.id,
        selectorType: 'VERSION',
        versionId: version.id,
      }),
    ).resolves.toMatchObject({ targetId: taskId });
  });

  it('模板变量未在 schema 声明时拒绝创建 Version', async () => {
    const prompt = await service.create({
      key: `schema-${randomUUID()}`,
      name: '变量约束',
      kind: 'TEMPLATE',
      type: 'TEXT',
    });
    await expect(
      service.createVersion(prompt.id, {
        content: { text: '执行 {{ task }}' },
        variables: { type: 'object', properties: {}, required: [] },
      }),
    ).rejects.toMatchObject({ code: 'PROMPT_VARIABLE_UNDECLARED' });
  });

  it('Skill scan 阻止 symlink 逃逸 Project root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-skill-outside-'));
    try {
      await writeFile(join(outside, 'SKILL.md'), '---\nname: 外部 Skill\n---\n', 'utf8');
      const skillsRoot = join(projectRoot, '.codex/skills');
      await mkdir(skillsRoot, { recursive: true });
      await symlink(outside, join(skillsRoot, 'escape'));
      await expect(service.scanSkills(projectId)).rejects.toMatchObject({
        code: 'SKILL_PATH_ESCAPE',
      });
    } finally {
      await rm(join(projectRoot, '.codex'), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
