import type { GitCommitOperationRequest } from '@agenthub/shared';
export {
  gitCommitOperationParams,
  gitCommitOperationBody,
  type GitCommitOperationRequest,
} from '@agenthub/shared';

export function gitCommitOperationPayload(input: GitCommitOperationRequest) {
  return {
    operationKind: 'COMMIT' as const,
    mode: input.mode,
    message: input.message,
    ...(input.paths ? { paths: [...input.paths] } : {}),
  };
}
