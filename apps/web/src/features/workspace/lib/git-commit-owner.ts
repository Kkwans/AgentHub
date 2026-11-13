import { ApiError } from '../../../lib/api-error';

export type GitCommitInput = Readonly<{
  projectId: string;
  paths: readonly string[];
  message: string;
}>;
export type GitCommitOperation = Readonly<{
  id: number;
  epoch: number;
  input: GitCommitInput;
  phase: 'pending' | 'unknown' | 'rejected' | 'committed';
  sha?: string;
  error?: string;
}>;
const locked = (record: GitCommitOperation) =>
  record.phase === 'pending' || record.phase === 'unknown';

/** Session-memory core, NOT yet wired to the UI. A provider must live above routes,
 * revoke on identity changes, and never present a previous owner's records.
 * No storage, server idempotency or reload recovery is supplied by this module. */
export function createGitCommitOwner() {
  let epoch = 0;
  let sequence = 0;
  let authorized = false;
  let records: readonly GitCommitOperation[] = Object.freeze([]);
  const listeners = new Set<() => void>();
  const publish = () => {
    records = Object.freeze([...records]);
    listeners.forEach((listener) => listener());
  };
  const revoke = () => {
    epoch += 1;
    authorized = false;
    records = [];
    publish();
  };
  return {
    activate() {
      revoke();
      authorized = true;
    },
    revoke,
    getSnapshot: () => records,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isLocked(projectId: string) {
      return records.some((record) => record.input.projectId === projectId && locked(record));
    },
    dismiss(id: number) {
      const record = records.find((item) => item.id === id);
      if (!record || locked(record)) return false;
      records = records.filter((item) => item !== record);
      publish();
      return true;
    },
    async submit(
      input: GitCommitInput,
      send: (input: GitCommitInput) => Promise<unknown>,
      onCommitted?: (input: GitCommitInput, sha: string) => void | Promise<void>,
    ): Promise<GitCommitOperation | undefined> {
      if (!authorized) throw new Error('授权已失效，未发起 Git 提交。');
      if (records.some((record) => record.input.projectId === input.projectId && locked(record))) {
        throw new Error('原 Git 提交结果尚未确认，禁止重复提交。');
      }
      if (!input.projectId.trim() || !input.paths.length || !input.message.trim()) {
        throw new Error('缺少 Project、文件或提交说明，未发起 Git 提交。');
      }
      const original: GitCommitInput = Object.freeze({
        projectId: input.projectId,
        paths: Object.freeze([...input.paths]),
        message: input.message.trim(),
      });
      const operation: GitCommitOperation = Object.freeze({
        id: ++sequence,
        epoch,
        input: original,
        phase: 'pending',
      });
      // Publish the project lock synchronously before calling transport.
      records = [...records, operation];
      publish();
      const valid = () => authorized && epoch === operation.epoch;
      const settle = (next: GitCommitOperation) => {
        if (!valid() || !records.includes(operation)) return undefined;
        const frozen = Object.freeze(next);
        records = records.map((item) => (item === operation ? frozen : item));
        publish();
        return valid() ? frozen : undefined;
      };
      if (!valid()) return undefined;
      let result: unknown;
      try {
        result = await send(original);
        const sha =
          result && typeof result === 'object' ? (result as { sha?: unknown }).sha : undefined;
        if (typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) {
          throw new Error('响应缺少有效完整 SHA，提交结果未知。');
        }
      } catch (cause) {
        const safe =
          cause instanceof ApiError &&
          cause.status === 400 &&
          cause.code === 'GIT_COMMIT_PATHS_REQUIRED';
        return settle({
          ...operation,
          phase: safe ? 'rejected' : 'unknown',
          error: cause instanceof Error ? cause.message : '提交结果未知。',
        });
      }
      const sha = (result as { sha: string }).sha;
      const committed = settle({ ...operation, phase: 'committed', sha });
      // Cache refresh failures must not rewrite a verified transport receipt as unknown.
      // Callers own refresh error reporting. Revoked/ABA results never call this hook.
      if (committed && valid()) {
        try {
          await onCommitted?.(original, sha);
        } catch (error) {
          if (valid()) throw error;
        }
      }
      return valid() ? committed : undefined;
    },
  };
}
