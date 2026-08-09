import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type {
  AgentHubDatabase,
  ProjectRepository,
  PromptRepository,
  SkillRepository,
} from '@agenthub/db';
import { createTwoFilesPatch } from 'diff';

import { AppError } from '../errors.js';
import { assertContained } from '../projects/path-security.js';

export type PromptKind = 'SYSTEM' | 'TASK' | 'REVIEW' | 'COMMIT' | 'RULE' | 'TEMPLATE';
export type PromptType = 'TEXT' | 'CHAT';
export type BindingTargetType = 'PROJECT' | 'AGENT' | 'TASK';
export type BindingSlot = 'SYSTEM' | 'TASK_PRIMER' | 'REVIEW' | 'COMMIT' | 'RULES';

export interface CreateVersionInput {
  content: Record<string, unknown>;
  variables?: Record<string, unknown> | undefined;
  config?: Record<string, unknown> | undefined;
  changelog?: string | undefined;
  source?: string | undefined;
  createdBy?: string | undefined;
}

export interface RenderInput {
  label?: string | undefined;
  version?: number | undefined;
  variables?: Record<string, unknown> | undefined;
}

export interface ResolvedPromptItem {
  bindingId: string;
  targetType: string;
  targetId: string;
  slot: string;
  priority: number;
  promptId: string;
  promptKey: string;
  promptName: string;
  label: string | null;
  versionId: string;
  version: number;
  contentHash: string;
  renderedContent: Record<string, unknown>;
  renderedText: string;
  missingVariables: string[];
}

export interface ResolvedPromptContext {
  ready: boolean;
  finalContext: string;
  missingVariables: string[];
  items: ResolvedPromptItem[];
}

export class PromptService {
  constructor(
    private readonly repository: PromptRepository<AgentHubDatabase>,
    private readonly skills: SkillRepository<AgentHubDatabase>,
    private readonly projects: ProjectRepository<AgentHubDatabase>,
  ) {}

  list(projectId?: string) {
    return this.repository.listPrompts(projectId);
  }

  async get(id: string) {
    const prompt = await this.repository.getPrompt(id);
    if (!prompt || prompt.archivedAt) throw new AppError(404, 'PROMPT_NOT_FOUND', 'Prompt 不存在');
    return prompt;
  }

  create(input: {
    projectId?: string | undefined;
    key: string;
    name: string;
    description?: string | undefined;
    kind: PromptKind;
    type: PromptType;
  }) {
    return this.repository.createPrompt({
      key: input.key,
      name: input.name,
      kind: input.kind,
      type: input.type,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.description ? { description: input.description } : {}),
    });
  }

  async update(
    id: string,
    patch: {
      name?: string | undefined;
      description?: string | null | undefined;
      kind?: PromptKind | undefined;
    },
  ) {
    await this.get(id);
    return this.repository.updatePrompt(id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    });
  }

  async archive(id: string) {
    await this.get(id);
    return this.repository.archivePrompt(id);
  }

  async listVersions(promptId: string) {
    await this.get(promptId);
    return this.repository.listVersions(promptId);
  }

  async getVersion(promptId: string, version: number) {
    await this.get(promptId);
    const record = await this.repository.getVersion(promptId, version);
    if (!record) throw new AppError(404, 'PROMPT_VERSION_NOT_FOUND', 'Prompt Version 不存在');
    return record;
  }

  async createVersion(promptId: string, input: CreateVersionInput) {
    const prompt = await this.get(promptId);
    validateContent(prompt.type as PromptType, input.content);
    validateVariableSchema(input.variables ?? {});
    validateDeclaredVariables(prompt.type as PromptType, input.content, input.variables ?? {});
    const contentHash = hashJson({
      content: input.content,
      variables: input.variables ?? {},
      config: input.config ?? {},
    });
    return this.repository.createNextVersion({
      promptId,
      content: input.content,
      ...(input.variables ? { variables: input.variables } : {}),
      ...(input.config ? { config: input.config } : {}),
      ...(input.changelog ? { changelog: input.changelog } : {}),
      source: input.source ?? 'UI',
      contentHash,
      createdBy: input.createdBy ?? 'local-user',
    });
  }

  async diff(promptId: string, from: number, to: number) {
    const prompt = await this.get(promptId);
    const [fromVersion, toVersion] = await Promise.all([
      this.getVersion(promptId, from),
      this.getVersion(promptId, to),
    ]);
    const fromText = comparableText(prompt.type as PromptType, fromVersion.contentJson);
    const toText = comparableText(prompt.type as PromptType, toVersion.contentJson);
    return {
      promptId,
      type: prompt.type,
      from,
      to,
      fromContent: fromVersion.contentJson,
      toContent: toVersion.contentJson,
      patch: createTwoFilesPatch(`v${from}`, `v${to}`, fromText, toText, '', '', {
        context: 4,
      }),
    };
  }

  async listLabels(promptId: string) {
    await this.get(promptId);
    return this.repository.listLabels(promptId);
  }

  async moveLabel(promptId: string, label: string, versionId: string) {
    await this.get(promptId);
    if (label === 'latest') {
      throw new AppError(409, 'PROMPT_LATEST_LABEL_MANAGED', 'latest Label 由系统自动维护');
    }
    return this.repository.moveLabel(promptId, label, versionId);
  }

  async deleteLabel(promptId: string, label: string) {
    await this.get(promptId);
    if (label === 'latest') {
      throw new AppError(409, 'PROMPT_LATEST_LABEL_MANAGED', 'latest Label 不允许删除');
    }
    const deleted = await this.repository.deleteLabel(promptId, label);
    if (!deleted) throw new AppError(404, 'PROMPT_LABEL_NOT_FOUND', 'Prompt Label 不存在');
    return deleted;
  }

  async render(promptId: string, input: RenderInput) {
    const prompt = await this.get(promptId);
    const resolved = await this.resolveVersion(promptId, input);
    const rendered = renderVersion(
      prompt.type as PromptType,
      resolved.version.contentJson,
      resolved.version.variablesJson,
      input.variables ?? {},
    );
    return {
      promptId,
      promptKey: prompt.key,
      versionId: resolved.version.id,
      version: resolved.version.version,
      label: resolved.label,
      contentHash: resolved.version.contentHash,
      ...rendered,
    };
  }

  listBindings(filters: {
    targetType?: string | undefined;
    targetId?: string | undefined;
    promptId?: string | undefined;
  }) {
    return this.repository.listBindings(filters);
  }

  async createBinding(input: {
    targetType: BindingTargetType;
    targetId: string;
    slot: BindingSlot;
    promptId: string;
    selectorType: 'LABEL' | 'VERSION';
    label?: string | undefined;
    versionId?: string | undefined;
    priority?: number | undefined;
    enabled?: boolean | undefined;
  }) {
    await this.validateBinding(input);
    return this.repository.createBinding({
      id: randomUUID(),
      ...input,
      priority: input.priority ?? 0,
      enabled: input.enabled ?? true,
    });
  }

  async updateBinding(
    id: string,
    patch: {
      slot?: BindingSlot | undefined;
      selectorType?: 'LABEL' | 'VERSION' | undefined;
      label?: string | null | undefined;
      versionId?: string | null | undefined;
      priority?: number | undefined;
      enabled?: boolean | undefined;
    },
  ) {
    const current = await this.repository.getBinding(id);
    if (!current) throw new AppError(404, 'PROMPT_BINDING_NOT_FOUND', 'Prompt Binding 不存在');
    const merged = { ...current, ...patch };
    await this.validateBinding({
      targetType: merged.targetType as BindingTargetType,
      targetId: merged.targetId,
      promptId: merged.promptId,
      selectorType: merged.selectorType as 'LABEL' | 'VERSION',
      ...(merged.label ? { label: merged.label } : {}),
      ...(merged.versionId ? { versionId: merged.versionId } : {}),
    });
    return this.repository.updateBinding(id, {
      ...(patch.slot !== undefined ? { slot: patch.slot } : {}),
      ...(patch.selectorType !== undefined ? { selectorType: patch.selectorType } : {}),
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.versionId !== undefined ? { versionId: patch.versionId } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
  }

  async deleteBinding(id: string) {
    const deleted = await this.repository.deleteBinding(id);
    if (!deleted) throw new AppError(404, 'PROMPT_BINDING_NOT_FOUND', 'Prompt Binding 不存在');
    return deleted;
  }

  resolve(input: {
    projectId: string;
    agentId?: string | undefined;
    taskId?: string | undefined;
    variables?: Record<string, unknown> | undefined;
  }): Promise<ResolvedPromptContext> {
    return this.resolveContext(input);
  }

  resolveForRun(input: {
    projectId: string;
    agentId: string;
    taskId?: string | null;
    variables?: Record<string, unknown> | undefined;
  }): Promise<ResolvedPromptContext> {
    return this.resolveContext({
      projectId: input.projectId,
      agentId: input.agentId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      variables: input.variables ?? {},
    });
  }

  listSkills(projectId?: string) {
    return this.skills.list(projectId);
  }

  async scanSkills(projectId: string) {
    const project = await this.projects.get(projectId);
    if (!project || project.archivedAt)
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
    const discovered = [];
    for (const relativeRoot of ['.agents/skills', '.codex/skills']) {
      const lexicalRoot = join(project.realRootPath, relativeRoot);
      assertContained(project.realRootPath, lexicalRoot, 'SKILL_PATH_ESCAPE');
      let root: string;
      let entries;
      try {
        root = await realpath(lexicalRoot);
        assertContained(project.realRootPath, root, 'SKILL_PATH_ESCAPE');
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const lexicalSkillRoot = join(root, entry.name);
        let skillRoot: string;
        let skillFile: string;
        let content: string;
        try {
          skillRoot = await realpath(lexicalSkillRoot);
          assertContained(project.realRootPath, skillRoot, 'SKILL_PATH_ESCAPE');
          skillFile = await realpath(join(skillRoot, 'SKILL.md'));
          assertContained(project.realRootPath, skillFile, 'SKILL_PATH_ESCAPE');
          content = await readFile(skillFile, 'utf8');
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        if (Buffer.byteLength(content) > 1_000_000) continue;
        const metadata = parseSkillMetadata(content, entry.name);
        const saved = await this.skills.upsert({
          id: randomUUID(),
          projectId,
          slug: entry.name,
          name: metadata.name,
          description: metadata.description,
          source: 'PROJECT_SCAN',
          rootPath: skillRoot,
          manifestJson: {
            skillFile: relative(project.realRootPath, skillFile),
            discoveredFrom: relativeRoot,
          },
          contentHash: createHash('sha256').update(content).digest('hex'),
          enabled: true,
        });
        if (saved) discovered.push(saved);
      }
    }
    return discovered;
  }

  listSkillBindings(targetType?: string, targetId?: string) {
    return this.skills.listBindings(targetType, targetId);
  }

  async createSkillBinding(input: {
    skillId: string;
    targetType: BindingTargetType;
    targetId: string;
    enabled?: boolean | undefined;
  }) {
    if (!(await this.skills.get(input.skillId))) {
      throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    }
    if (!(await this.repository.targetExists(input.targetType, input.targetId))) {
      throw new AppError(404, 'SKILL_BINDING_TARGET_NOT_FOUND', 'Skill Binding target 不存在');
    }
    return this.skills.createBinding({
      id: randomUUID(),
      ...input,
      enabled: input.enabled ?? true,
    });
  }

  private async validateBinding(input: {
    targetType: BindingTargetType;
    targetId: string;
    promptId: string;
    selectorType: 'LABEL' | 'VERSION';
    label?: string | undefined;
    versionId?: string | undefined;
  }) {
    await this.get(input.promptId);
    if (!(await this.repository.targetExists(input.targetType, input.targetId))) {
      throw new AppError(404, 'PROMPT_BINDING_TARGET_NOT_FOUND', 'Binding target 不存在');
    }
    if (input.selectorType === 'LABEL') {
      if (!input.label || input.versionId)
        throw new AppError(400, 'PROMPT_BINDING_SELECTOR_INVALID', 'Label selector 配置不合法');
      if (!(await this.repository.getLabel(input.promptId, input.label)))
        throw new AppError(404, 'PROMPT_LABEL_NOT_FOUND', 'Prompt Label 不存在');
      return;
    }
    if (!input.versionId || input.label)
      throw new AppError(400, 'PROMPT_BINDING_SELECTOR_INVALID', 'Version selector 配置不合法');
    if (!(await this.repository.getVersionById(input.promptId, input.versionId)))
      throw new AppError(404, 'PROMPT_VERSION_NOT_FOUND', 'Prompt Version 不存在');
  }

  private async resolveContext(input: {
    projectId: string;
    agentId?: string | undefined;
    taskId?: string | undefined;
    variables?: Record<string, unknown> | undefined;
  }): Promise<ResolvedPromptContext> {
    const targets: Array<{ type: BindingTargetType; id: string; rank: number }> = [
      { type: 'PROJECT', id: input.projectId, rank: 0 },
      ...(input.agentId ? [{ type: 'AGENT' as const, id: input.agentId, rank: 1 }] : []),
      ...(input.taskId ? [{ type: 'TASK' as const, id: input.taskId, rank: 2 }] : []),
    ];
    const bindings = (
      await Promise.all(
        targets.map(async (target) =>
          (await this.repository.listBindings({ targetType: target.type, targetId: target.id }))
            .filter((binding) => binding.enabled)
            .map((binding) => ({ binding, rank: target.rank })),
        ),
      )
    )
      .flat()
      .sort(
        (left, right) => left.rank - right.rank || left.binding.priority - right.binding.priority,
      );

    const items: ResolvedPromptItem[] = [];
    for (const { binding } of bindings) {
      const prompt = await this.get(binding.promptId);
      const resolved = await this.resolveVersion(binding.promptId, {
        ...(binding.selectorType === 'LABEL' && binding.label ? { label: binding.label } : {}),
        ...(binding.selectorType === 'VERSION' && binding.versionId
          ? {
              version: (await this.requireVersionById(binding.promptId, binding.versionId)).version,
            }
          : {}),
        variables: input.variables ?? {},
      });
      const rendered = renderVersion(
        prompt.type as PromptType,
        resolved.version.contentJson,
        resolved.version.variablesJson,
        input.variables ?? {},
      );
      items.push({
        bindingId: binding.id,
        targetType: binding.targetType,
        targetId: binding.targetId,
        slot: binding.slot,
        priority: binding.priority,
        promptId: prompt.id,
        promptKey: prompt.key,
        promptName: prompt.name,
        label: resolved.label,
        versionId: resolved.version.id,
        version: resolved.version.version,
        contentHash: resolved.version.contentHash,
        renderedContent: rendered.content,
        renderedText: rendered.text,
        missingVariables: rendered.missingVariables,
      });
    }
    const missingVariables = [...new Set(items.flatMap((item) => item.missingVariables))].sort();
    return {
      ready: missingVariables.length === 0,
      missingVariables,
      finalContext: items
        .filter((item) => item.missingVariables.length === 0)
        .map(
          (item) =>
            `[PromptOS ${item.slot} · ${item.promptKey}@v${item.version}]\n${item.renderedText}`,
        )
        .join('\n\n'),
      items,
    };
  }

  private async resolveVersion(promptId: string, input: RenderInput) {
    if (input.version !== undefined) {
      return { version: await this.getVersion(promptId, input.version), label: null };
    }
    const requestedLabel = input.label ?? 'production';
    let label = await this.repository.getLabel(promptId, requestedLabel);
    if (!label && input.label === undefined)
      label = await this.repository.getLabel(promptId, 'latest');
    if (!label) throw new AppError(404, 'PROMPT_LABEL_NOT_FOUND', 'Prompt Label 不存在');
    return {
      version: await this.requireVersionById(promptId, label.versionId),
      label: label.label,
    };
  }

  private async requireVersionById(promptId: string, versionId: string) {
    const version = await this.repository.getVersionById(promptId, versionId);
    if (!version) throw new AppError(404, 'PROMPT_VERSION_NOT_FOUND', 'Prompt Version 不存在');
    return version;
  }
}

function validateContent(type: PromptType, content: Record<string, unknown>): void {
  if (type === 'TEXT' && typeof content.text !== 'string') {
    throw new AppError(400, 'PROMPT_TEXT_CONTENT_INVALID', 'TEXT Prompt 必须包含 text 字段');
  }
  if (type === 'CHAT') {
    if (!Array.isArray(content.messages) || !content.messages.length) {
      throw new AppError(400, 'PROMPT_CHAT_CONTENT_INVALID', 'CHAT Prompt 必须包含 messages');
    }
    for (const message of content.messages) {
      if (
        !message ||
        typeof message !== 'object' ||
        typeof (message as Record<string, unknown>).role !== 'string' ||
        typeof (message as Record<string, unknown>).content !== 'string'
      ) {
        throw new AppError(
          400,
          'PROMPT_CHAT_MESSAGE_INVALID',
          'CHAT message 必须包含 role 和 content',
        );
      }
    }
  }
}

function validateVariableSchema(schema: Record<string, unknown>): void {
  if (!Object.keys(schema).length) return;
  if (
    schema.type !== 'object' ||
    (schema.properties !== undefined && !isRecord(schema.properties))
  ) {
    throw new AppError(
      400,
      'PROMPT_VARIABLE_SCHEMA_INVALID',
      '变量 schema 必须是 object JSON Schema',
    );
  }
  if (schema.required !== undefined && !isStringArray(schema.required)) {
    throw new AppError(
      400,
      'PROMPT_VARIABLE_SCHEMA_INVALID',
      '变量 schema required 必须是字符串数组',
    );
  }
}

function validateDeclaredVariables(
  type: PromptType,
  content: Record<string, unknown>,
  schema: Record<string, unknown>,
): void {
  const references = [
    ...comparableText(type, content).matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g),
  ].map((match) => match[1]!);
  if (!references.length) return;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const undeclared = references.filter(
    (reference) => !(reference in properties) && !(reference.split('.')[0]! in properties),
  );
  if (undeclared.length) {
    throw new AppError(400, 'PROMPT_VARIABLE_UNDECLARED', 'Prompt 变量未在 schema 中声明', {
      variables: [...new Set(undeclared)].sort(),
    });
  }
}

function renderVersion(
  type: PromptType,
  content: Record<string, unknown>,
  schema: Record<string, unknown>,
  variables: Record<string, unknown>,
) {
  validateVariableSchema(schema);
  const required = isStringArray(schema.required) ? schema.required : [];
  const missingVariables = required.filter((name) => getVariable(variables, name) === undefined);
  const renderText = (template: string) =>
    template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, name: string) => {
      const value = getVariable(variables, name);
      return value === undefined
        ? match
        : typeof value === 'string'
          ? value
          : JSON.stringify(value);
    });
  if (type === 'TEXT') {
    const text = renderText(String(content.text ?? ''));
    return { content: { ...content, text }, text, missingVariables };
  }
  const messages = Array.isArray(content.messages)
    ? content.messages.map((message): Record<string, unknown> => {
        const record = message as Record<string, unknown>;
        return { ...record, content: renderText(String(record.content ?? '')) };
      })
    : [];
  return {
    content: { ...content, messages },
    text: messages
      .map((message) => `[${String(message.role)}]\n${String(message.content)}`)
      .join('\n\n'),
    missingVariables,
  };
}

function comparableText(type: PromptType, content: Record<string, unknown>): string {
  return type === 'TEXT'
    ? String(content.text ?? '')
    : `${JSON.stringify(content.messages ?? [], null, 2)}\n`;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function getVariable(values: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    return isRecord(current) ? current[segment] : undefined;
  }, values);
}

function parseSkillMetadata(content: string, fallback: string) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? '';
  const fields = Object.fromEntries(
    frontmatter
      .split(/\r?\n/u)
      .map((line) => line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*["']?(.*?)["']?\s*$/u))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1]!, match[2] ?? '']),
  );
  return {
    name: fields.name || fallback,
    description: fields.description || null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
