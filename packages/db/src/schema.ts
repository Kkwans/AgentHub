import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const emptyObject = sql`'{}'::jsonb`;
const emptyArray = sql`'[]'::jsonb`;

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').$type<Record<string, unknown>>().notNull().default(emptyObject),
  updatedAt: updatedAt(),
});

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('api_tokens_name_unique').on(table.name)],
);

export const localAccounts = pgTable(
  'local_accounts',
  {
    id: uuid('id').primaryKey(),
    singletonKey: text('singleton_key').notNull().default('PRIMARY'),
    username: text('username').notNull(),
    normalizedUsername: text('normalized_username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('ADMIN'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('local_accounts_singleton_unique').on(table.singletonKey),
    uniqueIndex('local_accounts_username_unique').on(table.normalizedUsername),
    check('local_accounts_singleton_check', sql`${table.singletonKey} = 'PRIMARY'`),
    check('local_accounts_role_check', sql`${table.role} = 'ADMIN'`),
  ],
);

export const browserSessions = pgTable(
  'browser_sessions',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => localAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('browser_sessions_token_hash_unique').on(table.tokenHash),
    index('browser_sessions_account_idx').on(table.accountId),
    index('browser_sessions_expires_idx').on(table.expiresAt),
  ],
);

export const executionTargets = pgTable(
  'execution_targets',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    hostname: text('hostname').notNull(),
    os: text('os').notNull(),
    arch: text('arch').notNull(),
    status: text('status').notNull(),
    containerName: text('container_name'),
    expectedContainerId: text('expected_container_id'),
    startPolicy: text('start_policy'),
    workspaceMappingsJson: jsonb('workspace_mappings_json')
      .$type<Array<{ hostRoot: string; containerRoot: string }>>()
      .notNull()
      .default(emptyArray),
    capabilitiesJson: jsonb('capabilities_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    connectionJson: jsonb('connection_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'execution_targets_kind_check',
      sql`${table.kind} in ('LOCAL_HOST', 'DOCKER_CONTAINER', 'REMOTE_NODE')`,
    ),
    check(
      'execution_targets_start_policy_check',
      sql`${table.startPolicy} is null or ${table.startPolicy} in ('MANUAL', 'ON_DEMAND')`,
    ),
    check(
      'execution_targets_docker_fields_check',
      sql`${table.kind} <> 'DOCKER_CONTAINER' or (${table.containerName} is not null and ${table.expectedContainerId} is not null and ${table.startPolicy} is not null)`,
    ),
  ],
);

export const remoteNodes = pgTable(
  'remote_nodes',
  {
    id: uuid('id').primaryKey(),
    targetId: uuid('target_id')
      .notNull()
      .references(() => executionTargets.id),
    publicKey: text('public_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    protocolVersion: text('protocol_version').notNull(),
    daemonVersion: text('daemon_version').notNull(),
    allowedRootsJson: jsonb('allowed_roots_json').$type<string[]>().notNull().default(emptyArray),
    inventoryJson: jsonb('inventory_json')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(emptyArray),
    status: text('status').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('remote_nodes_target_unique').on(table.targetId),
    uniqueIndex('remote_nodes_fingerprint_unique').on(table.fingerprint),
    check('remote_nodes_status_check', sql`${table.status} in ('ONLINE', 'OFFLINE', 'REVOKED')`),
  ],
);

export const remoteNodeRegistrationTokens = pgTable(
  'remote_node_registration_tokens',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    allowedRootsJson: jsonb('allowed_roots_json').$type<string[]>().notNull().default(emptyArray),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByNodeId: uuid('used_by_node_id').references(() => remoteNodes.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('remote_node_registration_tokens_hash_unique').on(table.tokenHash)],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    targetId: uuid('target_id')
      .notNull()
      .references(() => executionTargets.id),
    rootPath: text('root_path').notNull(),
    realRootPath: text('real_root_path').notNull(),
    repoKind: text('repo_kind').notNull(),
    defaultAgentId: uuid('default_agent_id'),
    status: text('status').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [unique('projects_target_real_root_unique').on(table.targetId, table.realRootPath)],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey(),
    targetId: uuid('target_id')
      .notNull()
      .references(() => executionTargets.id),
    name: text('name').notNull(),
    agentKind: text('agent_kind').notNull(),
    adapterKind: text('adapter_kind').notNull(),
    executable: text('executable'),
    argsJson: jsonb('args_json').$type<string[]>().notNull().default(emptyArray),
    envRefsJson: jsonb('env_refs_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    configJson: jsonb('config_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    defaultModel: text('default_model'),
    defaultMode: text('default_mode'),
    capabilitiesJson: jsonb('capabilities_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    detectedVersion: text('detected_version'),
    status: text('status').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastPreflightAt: timestamp('last_preflight_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'agents_kind_check',
      sql`${table.agentKind} in ('CODEX', 'CLAUDE_CODE', 'OPENCODE', 'HERMES', 'OPENCLAW', 'CUSTOM_ACP')`,
    ),
    check(
      'agents_adapter_kind_check',
      sql`${table.adapterKind} in ('ACP_STDIO', 'OPENCLAW_GATEWAY', 'OPENCLAW_EXEC')`,
    ),
  ],
);

export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    taskId: uuid('task_id'),
    externalSessionId: text('external_session_id'),
    title: text('title').notNull(),
    cwd: text('cwd').notNull(),
    branch: text('branch'),
    status: text('status').notNull(),
    model: text('model'),
    mode: text('mode'),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'agent_sessions_status_check',
      sql`${table.status} in ('CREATED', 'STARTING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'DISCONNECTED', 'FAILED', 'CLOSED')`,
    ),
  ],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSessions.id),
    taskId: uuid('task_id'),
    parentRunId: uuid('parent_run_id'),
    inputMessageId: uuid('input_message_id'),
    externalRunId: text('external_run_id'),
    status: text('status').notNull(),
    model: text('model'),
    mode: text('mode'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    exitCode: integer('exit_code'),
    inputTokens: bigint('input_tokens', { mode: 'number' }),
    outputTokens: bigint('output_tokens', { mode: 'number' }),
    costAmount: numeric('cost_amount', { precision: 20, scale: 8 }),
    costCurrency: text('cost_currency'),
    gitBeforeSha: text('git_before_sha'),
    gitAfterSha: text('git_after_sha'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    metadataJson: jsonb('metadata_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
  },
  (table) => [
    check(
      'agent_runs_status_check',
      sql`${table.status} in ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING', 'CANCELED', 'COMPLETED', 'FAILED', 'DISCONNECTED')`,
    ),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSessions.id),
    runId: uuid('run_id').references(() => agentRuns.id),
    role: text('role').notNull(),
    kind: text('kind').notNull(),
    text: text('text'),
    contentJson: jsonb('content_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('messages_session_sequence_unique').on(table.sessionId, table.sequence),
    check('messages_role_check', sql`${table.role} in ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL')`),
  ],
);

export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSessions.id),
    runId: uuid('run_id').references(() => agentRuns.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    payloadJson: jsonb('payload_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    adapterEventType: text('adapter_event_type'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('run_events_session_seq_unique').on(table.sessionId, table.seq),
    index('run_events_session_seq_idx').on(table.sessionId, table.seq),
    index('run_events_run_created_idx').on(table.runId, table.createdAt),
    index('run_events_type_created_idx').on(table.type, table.createdAt),
  ],
);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSessions.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    optionsJson: jsonb('options_json')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(emptyArray),
    requestJson: jsonb('request_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    responseJson: jsonb('response_json').$type<Record<string, unknown>>(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    unique('approval_requests_run_external_unique').on(table.runId, table.externalId),
    check(
      'approval_requests_status_check',
      sql`${table.status} in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED')`,
    ),
  ],
);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => agentRuns.id),
  messageId: uuid('message_id').references(() => messages.id),
  type: text('type').notNull(),
  path: text('path').notNull(),
  displayName: text('display_name').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  sha256: text('sha256'),
  metadataJson: jsonb('metadata_json')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(emptyObject),
  createdAt: createdAt(),
});

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    description: text('description'),
    successCriteria: text('success_criteria'),
    status: text('status').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'goals_status_check',
      sql`${table.status} in ('DRAFT', 'ACTIVE', 'ACHIEVED', 'CANCELED')`,
    ),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    goalId: uuid('goal_id').references(() => goals.id),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    description: text('description'),
    acceptanceCriteria: text('acceptance_criteria'),
    status: text('status').notNull(),
    priority: integer('priority').notNull().default(0),
    assignedAgentId: uuid('assigned_agent_id').references(() => agents.id),
    sessionId: uuid('session_id'),
    finalRunId: uuid('final_run_id'),
    branch: text('branch'),
    position: numeric('position', { precision: 20, scale: 8 }).notNull().default('0'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('tasks_project_status_position_idx').on(table.projectId, table.status, table.position),
    index('tasks_goal_status_idx').on(table.goalId, table.status),
    index('tasks_agent_status_idx').on(table.assignedAgentId, table.status),
    check(
      'tasks_status_check',
      sql`${table.status} in ('BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'BLOCKED', 'CANCELED')`,
    ),
  ],
);

export const worktreeExecutions = pgTable(
  'worktree_executions',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    status: text('status').notNull(),
    baseBranch: text('base_branch').notNull(),
    baseSha: text('base_sha').notNull(),
    taskBranch: text('task_branch').notNull(),
    worktreePath: text('worktree_path'),
    sessionId: uuid('session_id').references(() => agentSessions.id),
    runId: uuid('run_id').references(() => agentRuns.id),
    mergeCommitSha: text('merge_commit_sha'),
    configJson: jsonb('config_json')
      .$type<{
        model?: string;
        mode?: string;
        promptVariables?: Record<string, unknown>;
      }>()
      .notNull()
      .default(emptyObject),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    reviewReadyAt: timestamp('review_ready_at', { withTimezone: true }),
    mergeStartedAt: timestamp('merge_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('worktree_executions_project_queue_idx').on(
      table.projectId,
      table.status,
      table.queuedAt,
    ),
    index('worktree_executions_task_created_idx').on(table.taskId, table.createdAt),
    unique('worktree_executions_project_branch_unique').on(table.projectId, table.taskBranch),
    uniqueIndex('worktree_executions_path_unique')
      .on(table.worktreePath)
      .where(sql`${table.worktreePath} is not null`),
    uniqueIndex('worktree_executions_task_active_unique')
      .on(table.taskId)
      .where(
        sql`${table.status} in ('QUEUED', 'SETTING_UP', 'RUNNING', 'AWAITING_INPUT', 'REVIEW', 'MERGING')`,
      ),
    uniqueIndex('worktree_executions_project_active_unique')
      .on(table.projectId)
      .where(
        sql`${table.status} in ('SETTING_UP', 'RUNNING', 'AWAITING_INPUT', 'REVIEW', 'MERGING')`,
      ),
    check(
      'worktree_executions_status_check',
      sql`${table.status} in ('QUEUED', 'SETTING_UP', 'RUNNING', 'AWAITING_INPUT', 'REVIEW', 'MERGING', 'DONE', 'BLOCKED', 'CANCELED')`,
    ),
  ],
);

export const prompts = pgTable(
  'prompts',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').references(() => projects.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull(),
    type: text('type').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('prompts_project_key_unique')
      .on(table.projectId, table.key)
      .where(sql`${table.projectId} is not null`),
    uniqueIndex('prompts_global_key_unique')
      .on(table.key)
      .where(sql`${table.projectId} is null`),
  ],
);

export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: uuid('id').primaryKey(),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id),
    version: integer('version').notNull(),
    contentJson: jsonb('content_json').$type<Record<string, unknown>>().notNull(),
    variablesJson: jsonb('variables_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    configJson: jsonb('config_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    changelog: text('changelog'),
    source: text('source').notNull(),
    contentHash: text('content_hash').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique('prompt_versions_prompt_version_unique').on(table.promptId, table.version)],
);

export const promptLabels = pgTable(
  'prompt_labels',
  {
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id),
    label: text('label').notNull(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => promptVersions.id),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.promptId, table.label] })],
);

export const promptBindings = pgTable(
  'prompt_bindings',
  {
    id: uuid('id').primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    slot: text('slot').notNull(),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id),
    selectorType: text('selector_type').notNull(),
    label: text('label'),
    versionId: uuid('version_id').references(() => promptVersions.id),
    priority: integer('priority').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('prompt_bindings_target_check', sql`${table.targetType} in ('PROJECT', 'AGENT', 'TASK')`),
    check(
      'prompt_bindings_slot_check',
      sql`${table.slot} in ('SYSTEM', 'TASK_PRIMER', 'REVIEW', 'COMMIT', 'RULES')`,
    ),
    check('prompt_bindings_selector_check', sql`${table.selectorType} in ('LABEL', 'VERSION')`),
    check(
      'prompt_bindings_selector_value_check',
      sql`(${table.selectorType} = 'LABEL' and ${table.label} is not null and ${table.versionId} is null) or (${table.selectorType} = 'VERSION' and ${table.versionId} is not null and ${table.label} is null)`,
    ),
  ],
);

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').references(() => projects.id),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  source: text('source').notNull(),
  rootPath: text('root_path').notNull(),
  manifestJson: jsonb('manifest_json')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(emptyObject),
  contentHash: text('content_hash').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const skillBindings = pgTable('skill_bindings', {
  id: uuid('id').primaryKey(),
  skillId: uuid('skill_id')
    .notNull()
    .references(() => skills.id),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});

export const gitSnapshots = pgTable(
  'git_snapshots',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    snapshotType: text('snapshot_type').notNull(),
    headSha: text('head_sha'),
    branch: text('branch'),
    statusJson: jsonb('status_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    diffStatJson: jsonb('diff_stat_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(emptyObject),
    patchFilePath: text('patch_file_path'),
    createdAt: createdAt(),
  },
  (table) => [
    check('git_snapshots_type_check', sql`${table.snapshotType} in ('BEFORE', 'AFTER', 'REVIEW')`),
  ],
);

export const schema = {
  appSettings,
  apiTokens,
  executionTargets,
  remoteNodes,
  remoteNodeRegistrationTokens,
  projects,
  agents,
  agentSessions,
  agentRuns,
  messages,
  runEvents,
  approvalRequests,
  artifacts,
  goals,
  tasks,
  prompts,
  promptVersions,
  promptLabels,
  promptBindings,
  skills,
  skillBindings,
  gitSnapshots,
  worktreeExecutions,
};
