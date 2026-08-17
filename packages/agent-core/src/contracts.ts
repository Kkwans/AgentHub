import type { NormalizedAgentEvent } from './events.js';

export type ExecutionTargetKind = 'LOCAL_HOST' | 'DOCKER_CONTAINER' | 'REMOTE_NODE';

export interface WorkspaceMapping {
  hostRoot: string;
  containerRoot: string;
}

export type AgentLaunchSpec =
  | { kind: 'HOST_PROCESS'; executable: string; args: string[] }
  | { kind: 'REMOTE_AGENT'; nodeId: string; inventoryKey: string }
  | {
      kind: 'DOCKER_EXEC';
      containerName: string;
      expectedContainerId: string;
      command: string;
      args: string[];
      startPolicy: 'MANUAL' | 'ON_DEMAND';
      workspaceMappings: WorkspaceMapping[];
    };

export type AgentKind = 'CODEX' | 'CLAUDE_CODE' | 'OPENCODE' | 'HERMES' | 'OPENCLAW' | 'CUSTOM_ACP';

export interface AgentProfile {
  id: string;
  name: string;
  agentKind: AgentKind;
  adapterKind: string;
  targetKind: ExecutionTargetKind;
  launchSpec: AgentLaunchSpec;
  defaultModel?: string;
  defaultMode?: string;
  config: Record<string, unknown>;
}

export interface AgentCapabilities {
  sessions: { create: boolean; load: boolean; resume: boolean; close: boolean };
  prompts: { text: boolean; images: boolean; resources: boolean };
  interaction: { streaming: boolean; approvals: boolean; questions: boolean; plan: boolean };
  workspace: {
    files: boolean;
    terminal: boolean;
    additionalRoots: boolean;
    mcpStdio: boolean;
    mcpHttp: boolean;
  };
  configuration: {
    models: boolean;
    modes: boolean;
    reasoningEffort: boolean;
    /** Options discovered from the provider's session configuration contract. */
    modelOptions?: ModelOption[];
    modeOptions?: ModelOption[];
    reasoningEffortOptions?: ModelOption[];
  };
  telemetry: { tokenUsage: boolean; cost: boolean };
}

export type PreflightStatus =
  | 'READY'
  | 'STOPPED'
  | 'MISSING'
  | 'BROKEN'
  | 'AUTH_REQUIRED'
  | 'WORKSPACE_UNMAPPED'
  | 'CONTAINER_REPLACED'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED';

export interface PreflightCheck {
  id: string;
  label: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  message: string;
  details?: Record<string, unknown>;
}

export interface PreflightReport {
  status: PreflightStatus;
  checkedAt: string;
  detectedVersion?: string;
  checks: PreflightCheck[];
  repair?: { summary: string; commands?: string[] };
}

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface CreateAgentSessionInput {
  sessionId: string;
  profile: AgentProfile;
  projectId: string;
  cwd: string;
  model?: string;
  mode?: string;
  additionalRoots?: string[];
  metadata?: Record<string, unknown>;
}

export interface LoadAgentSessionInput extends CreateAgentSessionInput {
  externalSessionId: string;
}

export interface ResumeAgentSessionInput extends LoadAgentSessionInput {
  lastKnownSeq?: number;
}

export interface AgentTurnInput {
  runId: string;
  text: string;
  content?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface AgentRunRef {
  runId: string;
  externalRunId?: string;
}

export interface ApprovalDecision {
  optionId: string;
  response?: Record<string, unknown>;
}

export interface AgentRuntimeAdapter {
  readonly kind: string;
  preflight(profile: AgentProfile): Promise<PreflightReport>;
  getCapabilities(profile: AgentProfile): Promise<AgentCapabilities>;
  discoverModels?(profile: AgentProfile): Promise<ModelOption[]>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle>;
  loadSession?(input: LoadAgentSessionInput): Promise<AgentSessionHandle>;
  resumeSession?(input: ResumeAgentSessionInput): Promise<AgentSessionHandle>;
}

export interface AgentSessionHandle {
  readonly externalSessionId: string | undefined;
  events(): AsyncIterable<NormalizedAgentEvent>;
  sendTurn(input: AgentTurnInput): Promise<AgentRunRef>;
  resolveApproval(id: string, decision: ApprovalDecision): Promise<void>;
  cancel(runId?: string): Promise<void>;
  close(): Promise<void>;
}

export const NO_AGENT_CAPABILITIES: AgentCapabilities = {
  sessions: { create: false, load: false, resume: false, close: false },
  prompts: { text: false, images: false, resources: false },
  interaction: { streaming: false, approvals: false, questions: false, plan: false },
  workspace: {
    files: false,
    terminal: false,
    additionalRoots: false,
    mcpStdio: false,
    mcpHttp: false,
  },
  configuration: { models: false, modes: false, reasoningEffort: false },
  telemetry: { tokenUsage: false, cost: false },
};
