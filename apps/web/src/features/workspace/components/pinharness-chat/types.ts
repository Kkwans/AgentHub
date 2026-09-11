/**
 * PinHarness chat entry contract at the AgentHub boundary.
 *
 * The copied PinHarness renderers intentionally consume this small display
 * shape instead of importing ACP/OpenClaw/provider types.  AgentHub converts
 * its normalized EventRecord into this shape before rendering.
 */

export type PinHarnessEntryType =
  | 'user_message'
  | 'assistant_message'
  | 'thinking'
  | 'tool_use'
  | 'plan'
  | 'round_summary'
  | 'subagent'
  | 'loading';

export type PinHarnessToolStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PinHarnessConversationEntry {
  id: string;
  entryType: 'user_message' | 'assistant_message' | 'thinking' | 'tool_use' | 'plan';
  content: string;
  messageId: string;
  timestamp: number;
  streaming: boolean;
  toolCallId?: string;
  toolTitle?: string;
  toolKind?: string;
  toolStatus?: PinHarnessToolStatus;
  rawInput?: Record<string, unknown>;
  rawOutput?: string;
  subagentId?: string;
  parentToolCallId?: string;
  lastChunkTime?: number;
  toolDurationMs?: number;
}

export interface PinHarnessSubagentDisplayData {
  rootEntry: PinHarnessConversationEntry;
  childEntries: PinHarnessConversationEntry[];
  description: string;
  status: string;
}

export interface PinHarnessDisplayEntry {
  id: string;
  type: PinHarnessEntryType;
  entry?: PinHarnessConversationEntry;
  subagent?: PinHarnessSubagentDisplayData;
  streaming?: boolean;
}
