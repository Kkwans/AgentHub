import { createHash } from 'node:crypto';
import type { AuthPrincipal } from '../auth/auth-service.js';
import { AppError } from '../errors.js';

export interface CreateTaskInput {
  projectId: string;
  goalId?: string | undefined;
  parentId?: string | undefined;
  title: string;
  description?: string | undefined;
  acceptanceCriteria?: string | undefined;
  priority?: number | undefined;
  branch?: string | undefined;
  position?: string | undefined;
  selectedPrompt?: { promptId: string; versionId?: string | undefined } | undefined;
  operationId?: string | undefined;
  promptVariables?: Record<string, unknown> | undefined;
}
export function creationOwnerScope(principal: AuthPrincipal | undefined): string {
  if (!principal) throw new AppError(401, 'AUTH_REQUIRED', '请先登录 AgentHub');
  if (principal.kind === 'browser_session') return `account:${principal.accountId}`;
  if (principal.kind === 'api_token') return `token:${principal.tokenId}`;
  if (principal.kind === 'local_trusted') return 'local-trusted';
  throw new AppError(401, 'AUTH_REQUIRED', '无法确认创建操作的认证身份');
}
function canonicalPosition(position = '0'): string {
  const negative = position.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? position.slice(1) : position).split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  const value = `${integer}${decimals ? `.${decimals}` : ''}`;
  return negative && value !== '0' ? `-${value}` : value;
}
export function taskCreationHash(input: CreateTaskInput): string {
  // Fixed keys and explicit database defaults, independent of JSON key order.
  // Only creation semantics are included; the key never authorizes starting a Run.
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...(input.promptVariables && Object.keys(input.promptVariables).length
          ? { promptVariables: canonicalVariables(input.promptVariables) }
          : {}),
        projectId: input.projectId.toLowerCase(),
        goalId: input.goalId?.toLowerCase() ?? null,
        parentId: input.parentId?.toLowerCase() ?? null,
        title: input.title.trim(),
        description: input.description ?? null,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        priority: input.priority ?? 0,
        branch: input.branch ?? null,
        position: canonicalPosition(input.position),
        selectedPrompt: input.selectedPrompt
          ? {
              promptId: input.selectedPrompt.promptId.toLowerCase(),
              versionId: input.selectedPrompt.versionId?.toLowerCase() ?? null,
            }
          : null,
      }),
    )
    .digest('hex');
}

function canonicalVariables(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalVariables);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalVariables(item)]),
    );
  return value;
}
