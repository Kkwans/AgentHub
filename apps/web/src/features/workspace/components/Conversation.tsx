/** Compatibility entry point. The rendered implementation follows the PinHarness source name. */
export { ChatConversationView, ChatConversationView as Conversation } from './ChatConversationView';
export { ChatEntryRenderer } from './ChatEntryRenderer';
export type { ChatEntryRendererProps } from './ChatEntryRenderer';
export {
  buildConversationTimeline,
  CONVERSATION_WINDOW_SIZE,
  CONVERSATION_WINDOW_STEP,
  getConversationWindowStart,
  groupToolTimeline,
  buildConversationTurns,
  mergeConversationText,
  summarizeToolExecution,
} from './conversationModel';
