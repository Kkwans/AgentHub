import { AppError } from '../errors.js';

export type RunStartPhase =
  'PREPARATION_FAILED' | 'PREPARATION_RECOVERY_REQUIRED' | 'DISPATCH_UNKNOWN';

// Internal type, not an arbitrary external code: callers must not overwrite an
// already reconciled Task or an uncertain dispatch with a generic BLOCKED state.
export class RunStartError extends AppError {
  constructor(
    readonly phase: RunStartPhase,
    readonly sessionId: string,
    readonly runId: string,
  ) {
    const code = phase === 'DISPATCH_UNKNOWN' ? 'AGENT_RUN_DISPATCH_UNKNOWN' : `RUN_${phase}`;
    const message =
      phase === 'PREPARATION_FAILED'
        ? 'Run 准备失败，尚未向 Agent 发送指令；请核对原任务'
        : phase === 'PREPARATION_RECOVERY_REQUIRED'
          ? 'Run 准备失败且恢复未完成，已暂停此 Session 的新 Run；请核对原任务'
          : 'Run 发送结果无法确认，请核对原 Run；不会自动重发';
    // No raw persistence/adapter cause: it can contain prompt text or SQL values.
    super(phase === 'PREPARATION_RECOVERY_REQUIRED' ? 503 : 502, code, message, {
      phase,
      sessionId,
      runId,
    });
  }
}
