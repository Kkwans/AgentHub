/**
 * ChatEntryRenderer — direct source split from PinHarness
 * components/run/chat/ChatEntryRenderer.tsx.
 *
 * This file owns only the source renderer routing and visual entry cards. The
 * normalized AgentHub ConversationTimelineItem adapter remains the boundary.
 */

import {
  AlertTriangle,
  Brain,
  Button,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  ListChecks,
  ShieldCheck,
  Wrench,
} from '@agenthub/ui';
import { lazy, memo, Suspense } from 'react';
import { Link } from 'react-router-dom';

import type { EventRecord } from '../../../lib/api';
import {
  labelAgentEventType,
  labelApprovalStatus,
  presentAgentMessage,
} from '../../../presentation/domain-labels';
import type {
  ConversationApprovalItem,
  ConversationPlanItem,
  ConversationToolGroup,
  ConversationTimelineItem,
} from './conversationModel';
import { summarizeToolExecution } from './conversationModel';

const MarkdownMessage = lazy(() => import('./MarkdownMessage'));

/** PinHarness source name: route every display entry without reordering protocol events. */
export type ChatEntryRendererProps = {
  item: ConversationTimelineItem | ConversationToolGroup;
  resolving: string | undefined;
  resolveError: Error | undefined;
  resolveVariables: { id: string; optionId: string } | undefined;
  activeThoughtId: string | undefined;
  onResolve: (variables: { id: string; optionId: string }) => void;
};

function ChatEntryRendererView({
  item,
  resolving,
  resolveError,
  resolveVariables,
  activeThoughtId,
  onResolve,
}: ChatEntryRendererProps) {
  if (item.kind === 'tool-group') {
    return <ToolExecutionGroupRow events={item.events} />;
  }
  if (item.kind === 'plan') return <PlanEventRow plan={item} />;
  if (item.kind === 'tool') return <ToolEventRow event={item.event} />;
  if (item.kind === 'approval') {
    return (
      <ApprovalEventRow
        approvalItem={item}
        resolving={resolving}
        resolveError={resolveError}
        resolveVariables={resolveVariables}
        onResolve={onResolve}
      />
    );
  }
  if (item.kind === 'thought') {
    return <ThoughtEventRow thought={item} running={item.id === activeThoughtId} />;
  }

  const { message } = item;
  const presentation = presentAgentMessage(message.text);
  const isUser = message.role === 'USER';
  const author =
    message.role === 'USER'
      ? '你'
      : message.role === 'ASSISTANT'
        ? 'Agent'
        : message.role === 'SYSTEM'
          ? '系统'
          : '工具';
  const timestamp = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  return (
    <div
      className={
        isUser
          ? 'group/msg flex justify-end px-3 py-1.5 animate-[hci-entry_200ms_ease-out_both] motion-reduce:animate-none sm:px-4'
          : 'min-w-0 px-0.5 py-1'
      }
      data-chat-entry
    >
      {isUser && timestamp ? (
        <span className="mr-2 self-center text-[10px] text-[hsl(var(--foreground-faint))] opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100">
          {timestamp}
        </span>
      ) : null}
      <article
        className={
          isUser
            ? 'message user message-user min-w-0 max-w-[88%] sm:max-w-[78%]'
            : `message ${message.role.toLowerCase()} message-assistant min-w-0 text-[13px] leading-relaxed text-[hsl(var(--foreground))]`
        }
        data-streaming={item.streaming ? 'true' : undefined}
      >
        {!isUser && message.role !== 'ASSISTANT' ? (
          <span className="mb-1 block text-[11px] font-medium text-[hsl(var(--foreground-faint))]">
            {author}
          </span>
        ) : null}
        {presentation.kind === 'TRANSPORT_ERROR' ? (
          <div className="message-body message-body-error rounded-lg border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))] px-3 py-2.5 text-[hsl(var(--destructive))]">
            <strong>{presentation.title}</strong>
            <p className="mt-1.5 text-[hsl(var(--foreground-muted))]">{presentation.text}</p>
            <details className="message-debug mt-2.5 text-[12px] text-[hsl(var(--foreground-muted))]">
              <summary>显示脱敏诊断</summary>
              <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-[hsl(var(--destructive-soft))]/60 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {presentation.debug}
              </pre>
            </details>
          </div>
        ) : (
          <div
            className={`message-body message-markdown min-w-0 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:m-0 [&_p+p]:mt-3 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[hsl(var(--border-strong))] [&_blockquote]:pl-3 [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[hsl(var(--border))] [&_pre]:bg-[hsl(var(--surface-muted))] [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_code]:font-mono [&_code]:text-[0.88em] [&_a]:text-[hsl(var(--primary))] [&_a]:underline-offset-2 hover:[&_a]:underline ${isUser ? 'max-w-full rounded-2xl rounded-tr-md border border-[hsl(var(--primary))]/18 bg-gradient-to-br from-[hsl(var(--primary))]/[0.09] to-[hsl(var(--primary))]/[0.05] px-3.5 py-2.5 shadow-[0_1px_4px_hsl(var(--foreground)/0.06)] transition-[border-color,box-shadow] duration-150 hover:border-[hsl(var(--primary))]/28 hover:shadow-[0_2px_8px_hsl(var(--primary)/0.1)]' : ''}`}
          >
            <RichMessage text={presentation.text} />
            {item.streaming && (
              <span
                className="streaming-type-caret ml-1 inline-block w-0.5 text-[hsl(var(--primary))] animate-[streaming-type-caret-blink_820ms_steps(1,end)_infinite] motion-reduce:animate-none"
                aria-label="正在接收 Agent 回复"
                role="status"
              >
                ▍
              </span>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

/**
 * PinHarness keeps completed entry subtrees stable while a streaming delta
 * updates the active entry. AgentHub's timeline adapter creates fresh wrapper
 * objects on each query refresh, so compare the visual fields instead of only
 * relying on reference equality.
 */
export function areChatEntryRendererPropsEqual(
  previous: ChatEntryRendererProps,
  next: ChatEntryRendererProps,
): boolean {
  if (previous.resolving !== next.resolving) return false;
  if (previous.activeThoughtId !== next.activeThoughtId) return false;
  if (previous.onResolve !== next.onResolve) return false;
  if (!sameError(previous.resolveError, next.resolveError)) return false;
  if (!sameResolveVariables(previous.resolveVariables, next.resolveVariables)) return false;
  return sameTimelineItem(previous.item, next.item);
}

function sameError(previous: Error | undefined, next: Error | undefined): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.message === next.message && readErrorCode(previous) === readErrorCode(next);
}

function readErrorCode(error: Error): string | undefined {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function sameResolveVariables(
  previous: ChatEntryRendererProps['resolveVariables'],
  next: ChatEntryRendererProps['resolveVariables'],
): boolean {
  return previous?.id === next?.id && previous?.optionId === next?.optionId;
}

function sameTimelineItem(
  previous: ChatEntryRendererProps['item'],
  next: ChatEntryRendererProps['item'],
): boolean {
  if (previous === next) return true;
  if (previous.kind !== next.kind || previous.id !== next.id) return false;
  if (previous.kind === 'message' && next.kind === 'message') {
    return (
      previous.streaming === next.streaming &&
      previous.createdAt === next.createdAt &&
      previous.message.id === next.message.id &&
      previous.message.role === next.message.role &&
      previous.message.text === next.message.text &&
      previous.message.sequence === next.message.sequence &&
      previous.message.createdAt === next.message.createdAt
    );
  }
  if (previous.kind === 'thought' && next.kind === 'thought') {
    return (
      previous.streaming === next.streaming &&
      previous.createdAt === next.createdAt &&
      previous.updatedAt === next.updatedAt &&
      previous.runId === next.runId &&
      previous.text === next.text
    );
  }
  if (previous.kind === 'tool' && next.kind === 'tool') {
    return sameEvent(previous.event, next.event);
  }
  if (previous.kind === 'plan' && next.kind === 'plan') {
    return previous.firstSeq === next.firstSeq && sameEvent(previous.event, next.event);
  }
  if (previous.kind === 'approval' && next.kind === 'approval') {
    return (
      previous.firstSeq === next.firstSeq &&
      (previous.approval === next.approval || sameApproval(previous.approval, next.approval))
    );
  }
  if (previous.kind === 'tool-group' && next.kind === 'tool-group') {
    return (
      previous.events.length === next.events.length &&
      previous.events.every((event, index) => {
        const nextEvent = next.events[index];
        return nextEvent ? sameEvent(event, nextEvent) : false;
      })
    );
  }
  return false;
}

function sameApproval(
  previous: ConversationApprovalItem['approval'],
  next: ConversationApprovalItem['approval'],
): boolean {
  return (
    previous.id === next.id &&
    previous.status === next.status &&
    previous.selectedOptionId === next.selectedOptionId &&
    previous.deliveryState === next.deliveryState &&
    previous.deliveryErrorCode === next.deliveryErrorCode &&
    previous.deliveryErrorMessage === next.deliveryErrorMessage &&
    previous.optionsJson.length === next.optionsJson.length &&
    previous.optionsJson.every((option, index) => {
      const nextOption = next.optionsJson[index];
      return (
        nextOption?.id === option.id &&
        nextOption?.label === option.label &&
        nextOption?.kind === option.kind
      );
    })
  );
}

function sameEvent(previous: EventRecord, next: EventRecord): boolean {
  return (
    previous === next ||
    (previous.id === next.id &&
      previous.sessionId === next.sessionId &&
      previous.runId === next.runId &&
      previous.seq === next.seq &&
      previous.type === next.type &&
      previous.createdAt === next.createdAt &&
      sameToolPayload(previous.payloadJson, next.payloadJson))
  );
}

/** Compare only fields rendered by the collapsed/expanded tool rows. */
function sameToolPayload(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  const keys = [
    'status',
    'tool',
    'name',
    'title',
    'command',
    'path',
    'query',
    'url',
    'kind',
    'locations',
    'paths',
    'entries',
    'update',
    'removed',
    'planId',
    'content',
    'uri',
  ] as const;
  return keys.every((key) => JSON.stringify(previous[key]) === JSON.stringify(next[key]));
}

export const ChatEntryRenderer = memo(ChatEntryRendererView, areChatEntryRendererPropsEqual);
ChatEntryRenderer.displayName = 'ChatEntryRenderer';

function formatToolExecutionSummary(summary: ReturnType<typeof summarizeToolExecution>): string {
  return [
    `执行了 ${summary.operations} 个操作`,
    summary.files ? `${summary.files} 文件` : undefined,
    summary.commands ? `${summary.commands} 命令` : undefined,
    summary.searches ? `${summary.searches} 搜索` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

type PlanEntryView = {
  content: string;
  status: string;
  priority?: string;
};

type PlanPresentation = {
  entries: PlanEntryView[];
  markdown?: string;
  file?: string;
  removed: boolean;
};

function PlanEventRow({ plan }: { plan: ConversationPlanItem }) {
  const presentation = readPlanPresentation(plan.event.payloadJson);
  const completed = presentation.entries.filter((entry) => entry.status === 'completed').length;
  const title = presentation.removed
    ? '执行计划已移除'
    : presentation.entries.length
      ? `执行计划 · ${completed}/${presentation.entries.length} 完成`
      : presentation.markdown
        ? '执行计划说明'
        : presentation.file
          ? '执行计划文件'
          : '执行计划已更新';
  return (
    <details className="plan-event-row tool-entry-motion tool-entry-card mx-auto w-full max-w-3xl">
      <summary
        className="tool-entry-trigger tool-entry-trigger--interactive"
        aria-label={`${title}，展开执行计划详情`}
      >
        <span className="tool-event-icon tool-entry-icon" aria-hidden="true">
          <ListChecks size={14} />
        </span>
        <span className="tool-event-copy min-w-0 flex-1">
          <span>
            <strong>{title}</strong>
            <small className="tool-entry-badge">Agent 计划</small>
          </span>
          {plan.updatedAt && plan.updatedAt !== plan.createdAt ? (
            <code>{new Date(plan.updatedAt).toLocaleTimeString('zh-CN')}</code>
          ) : null}
        </span>
        <ChevronRight
          className="tool-event-action tool-entry-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="plan-event-detail tool-entry-detail border-t border-[hsl(var(--border))]/35 px-3 py-2">
        {presentation.entries.length ? (
          <ol className="plan-event-list grid gap-1.5">
            {presentation.entries.map((entry, index) => (
              <li
                key={`${entry.content}-${index}`}
                className="flex min-w-0 items-start gap-2 text-xs"
              >
                <PlanStatusIcon status={entry.status} />
                <span
                  className={`min-w-0 flex-1 leading-relaxed ${entry.status === 'completed' ? 'text-[hsl(var(--foreground-subtle))] line-through' : 'text-[hsl(var(--foreground))]'}`}
                >
                  {entry.content}
                </span>
                <small className="shrink-0 text-[11px] text-[hsl(var(--foreground-faint))]">
                  {labelPlanStatus(entry.status)}
                </small>
              </li>
            ))}
          </ol>
        ) : null}
        {presentation.markdown ? <RichMessage text={presentation.markdown} /> : null}
        {presentation.file ? (
          <code className="mt-1 block truncate">{presentation.file}</code>
        ) : null}
        {presentation.removed ? (
          <span className="text-xs text-[hsl(var(--foreground-muted))]">
            Agent 已清理这份计划。
          </span>
        ) : null}
        {!presentation.entries.length &&
        !presentation.markdown &&
        !presentation.file &&
        !presentation.removed ? (
          <span className="text-xs text-[hsl(var(--foreground-muted))]">
            暂无可展开的计划内容。
          </span>
        ) : null}
      </div>
    </details>
  );
}

function readPlanPresentation(payload: Record<string, unknown>): PlanPresentation {
  const update = isRecord(payload.update) ? payload.update : payload;
  const rawEntries = Array.isArray(update.entries) ? update.entries : [];
  const entries = rawEntries.flatMap((entry): PlanEntryView[] => {
    if (!isRecord(entry) || typeof entry.content !== 'string') return [];
    return [
      {
        content: entry.content,
        status: typeof entry.status === 'string' ? entry.status.toLowerCase() : 'pending',
        ...(typeof entry.priority === 'string' ? { priority: entry.priority } : {}),
      },
    ];
  });
  return {
    entries,
    ...(typeof update.content === 'string' ? { markdown: update.content } : {}),
    ...(typeof update.uri === 'string' ? { file: update.uri } : {}),
    removed: payload.removed === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function labelPlanStatus(status: string): string {
  if (status === 'completed' || status === 'done') return '已完成';
  if (status === 'in_progress' || status === 'running') return '进行中';
  if (status === 'cancelled' || status === 'canceled') return '已取消';
  return '待处理';
}

function PlanStatusIcon({ status }: { status: string }) {
  if (status === 'completed' || status === 'done') {
    return <CheckCircle2 className="mt-0.5 shrink-0 text-[hsl(var(--success))]" size={13} />;
  }
  if (status === 'in_progress' || status === 'running') {
    return <LoaderCircle className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={13} />;
  }
  return (
    <span className="mt-1 size-2 shrink-0 rounded-full border border-[hsl(var(--foreground-faint))]" />
  );
}

function ApprovalEventRow({
  approvalItem,
  resolving,
  resolveError,
  resolveVariables,
  onResolve,
}: {
  approvalItem: ConversationApprovalItem;
  resolving: string | undefined;
  resolveError: Error | undefined;
  resolveVariables: { id: string; optionId: string } | undefined;
  onResolve: (variables: { id: string; optionId: string }) => void;
}) {
  const { approval } = approvalItem;
  const awaitingDecision = approval.status === 'PENDING';
  const deliveryInProgress = ['QUEUED', 'CLAIMED', 'DISPATCHING', 'RETRY_WAIT'].includes(
    approval.deliveryState ?? '',
  );
  const deliveryUnconfirmed = approval.deliveryState === 'UNKNOWN';
  const deliveryAborted = approval.deliveryState === 'DEAD';
  const selectedOption = approval.optionsJson.find(
    (option) => option.id === approval.selectedOptionId,
  );
  const deliveryStateLabel =
    approval.deliveryState === 'UNKNOWN'
      ? '状态无法确认'
      : approval.deliveryState === 'DEAD'
        ? '未发送给 Agent'
        : approval.deliveryState === 'DELIVERED'
          ? 'Agent 已接收'
          : approval.deliveryState
            ? '正在处理'
            : '尚未发送';
  const deliveryFailureCopy =
    approval.deliveryState === 'UNKNOWN'
      ? 'Agent 没有在限定时间内确认，系统不会自动重发，避免同一权限操作执行两次。'
      : '系统未能将这个决定交给 Agent。请恢复 Session 后重新开始。';
  return (
    <article
      className={`approval-card tool-entry-motion tool-entry-card mx-auto w-full max-w-3xl rounded-lg border px-3.5 py-3 ${deliveryUnconfirmed || deliveryAborted ? 'approval-card-attention border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive-soft))]/45' : 'border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning-soft))]/45'}`}
      data-sequence={approvalItem.firstSeq}
    >
      <div className="approval-heading flex items-start gap-2.5">
        <span>
          {deliveryInProgress ? (
            <LoaderCircle className="spin" size={17} />
          ) : deliveryUnconfirmed || deliveryAborted ? (
            <AlertTriangle size={17} />
          ) : (
            <ShieldCheck size={17} />
          )}
        </span>
        <div className="approval-heading-copy grid min-w-0 gap-0.5">
          <small className="approval-kicker text-[11px] text-[hsl(var(--foreground-muted))]">
            {awaitingDecision ? 'Agent 请求' : deliveryInProgress ? '正在处理' : '投递结果'}
          </small>
          <strong className="text-[13px] text-[hsl(var(--foreground))]">{approval.title}</strong>
        </div>
      </div>
      {approval.description && (
        <div className="approval-impact mt-3 grid gap-1 border-t border-[hsl(var(--border))]/45 pt-2 text-[12px]">
          <span>影响</span>
          <p>{approval.description}</p>
        </div>
      )}
      {awaitingDecision && (
        <>
          <span className="approval-options-label mt-3 block text-[11px] font-medium text-[hsl(var(--foreground-muted))]">
            可选操作
          </span>
          {approval.optionsJson.some((option) => option.id) ? (
            <div
              className="approval-actions mt-2 flex flex-wrap gap-2"
              aria-label="合法操作选项"
              aria-busy={resolving === approval.id}
            >
              {approval.optionsJson.map(
                (option) =>
                  option.id && (
                    <Button
                      key={option.id}
                      size="xs"
                      variant={
                        /reject|deny|refuse/i.test(
                          `${option.kind ?? ''} ${option.id} ${option.label ?? ''}`,
                        )
                          ? 'outline'
                          : 'default'
                      }
                      onClick={() => onResolve({ id: approval.id, optionId: option.id! })}
                      disabled={Boolean(resolving)}
                    >
                      {option.label ?? option.id}
                    </Button>
                  ),
              )}
            </div>
          ) : (
            <div
              className="approval-no-options mt-2 rounded-md border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))] px-2.5 py-2 text-[12px]"
              role="alert"
            >
              Agent 没有提供可执行选项，请返回 Session 列表重新开始。
            </div>
          )}
        </>
      )}
      {deliveryInProgress && (
        <div
          className="approval-delivery-status mt-3 grid gap-1 rounded-md border border-[hsl(var(--border))]/45 bg-[hsl(var(--surface))]/65 px-2.5 py-2 text-[12px]"
          role="status"
          aria-live="polite"
        >
          <strong>决定已保存</strong>
          <span>
            已选择“{selectedOption?.label ?? '已记录选项'}”，正在等待 Agent 确认接收，请勿重复操作。
          </span>
        </div>
      )}
      {deliveryUnconfirmed && (
        <div
          className="approval-delivery-status approval-delivery-status-danger mt-3 grid gap-1 rounded-md border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))]/70 px-2.5 py-2 text-[12px]"
          role="alert"
        >
          <strong>无法确认 Agent 是否收到</strong>
          <span>{deliveryFailureCopy}</span>
          <Link to="/sessions">前往 Session 列表恢复或重新开始</Link>
        </div>
      )}
      {deliveryAborted && (
        <div
          className="approval-delivery-status approval-delivery-status-danger mt-3 grid gap-1 rounded-md border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive-soft))]/70 px-2.5 py-2 text-[12px]"
          role="alert"
        >
          <strong>决定没有发送给 Agent</strong>
          <span>{deliveryFailureCopy}</span>
          <Link to="/sessions">前往 Session 列表处理</Link>
        </div>
      )}
      {resolveVariables?.id === approval.id && resolveError && (
        <div className="workspace-query-error" role="alert">
          <span>{resolveError.message}</span>
          {((resolveError as Error & { code?: string }).code ?? '') !==
            'APPROVAL_DECISION_CONFLICT' && (
            <Button
              size="xs"
              variant="destructive"
              disabled={Boolean(resolving)}
              onClick={() => onResolve(resolveVariables)}
            >
              重试此选项
            </Button>
          )}
        </div>
      )}
      <details className="approval-debug mt-3 border-t border-[hsl(var(--border))]/40 pt-2 text-[11px] text-[hsl(var(--foreground-muted))]">
        <summary>显示诊断信息</summary>
        <dl>
          <div>
            <dt>Approval</dt>
            <dd>
              <code>{approval.id}</code>
            </dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{labelApprovalStatus(approval.status)}</dd>
          </div>
          <div>
            <dt>投递</dt>
            <dd>{deliveryStateLabel}</dd>
          </div>
          {approval.deliveryErrorCode && (
            <div>
              <dt>错误码</dt>
              <dd>
                <code>{approval.deliveryErrorCode}</code>
              </dd>
            </div>
          )}
          {approval.deliveryErrorMessage && (
            <div>
              <dt>原始信息</dt>
              <dd>{approval.deliveryErrorMessage}</dd>
            </div>
          )}
        </dl>
      </details>
    </article>
  );
}

function ToolExecutionGroupRow({ events }: { events: EventRecord[] }) {
  const summary = summarizeToolExecution(events);
  const title = formatToolExecutionSummary(summary);
  const status = events.some((event) => event.type.endsWith('.failed'))
    ? 'failed'
    : events.some((event) => !event.type.endsWith('.completed'))
      ? 'running'
      : 'completed';
  const labels = [...new Set(events.map((event) => toolEventTitle(event)))];
  const details = labels.slice(0, 3).join('、');
  return (
    <details
      className={`tool-event-row tool-entry-motion tool-entry-card tool-execution-group tool-event-${status} mx-auto w-full max-w-3xl`}
    >
      <summary
        className="tool-entry-trigger tool-entry-trigger--interactive"
        aria-label={`${title}，展开执行详情`}
      >
        <span className="tool-event-icon tool-entry-icon" aria-hidden="true">
          {status === 'running' ? (
            <LoaderCircle className="spin" size={14} />
          ) : status === 'failed' ? (
            <AlertTriangle size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
        </span>
        <span className="tool-event-copy min-w-0 flex-1">
          <span>
            <strong>{title}</strong>
            <small className="tool-entry-badge">
              {status === 'completed' ? '已完成' : status === 'failed' ? '部分失败' : '进行中'}
            </small>
          </span>
          {details && <code>{details}</code>}
        </span>
        <ChevronRight
          className="tool-event-action tool-entry-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="tool-event-detail tool-entry-detail">
        <ul className="tool-event-group-list tool-entry-detail-body space-y-1 border-t border-[hsl(var(--border))]/35 px-3 py-2">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{toolEventTitle(event)}</strong>
              <span>{toolEventStatus(event)}</span>
              {toolEventDetail(event) && <code>{toolEventDetail(event)}</code>}
            </li>
          ))}
        </ul>
        <Link to="?view=activity">
          <Wrench size={12} aria-hidden="true" /> 在工具检查器中查看完整记录
        </Link>
      </div>
    </details>
  );
}

function ToolEventRow({ event }: { event: EventRecord }) {
  const status = toolEventStatusValue(event);
  const title = toolEventTitle(event);
  const detailValue = toolEventDetail(event);
  return (
    <details
      className={`tool-event-row tool-entry-motion tool-entry-card tool-event-${status} mx-auto w-full max-w-3xl`}
    >
      <summary
        className="tool-entry-trigger tool-entry-trigger--interactive"
        aria-label={`${title}，${labelAgentEventType(event.type)}，展开详情`}
      >
        <span className="tool-event-icon tool-entry-icon" aria-hidden="true">
          {status === 'running' ? (
            <LoaderCircle className="spin" size={14} />
          ) : status === 'failed' ? (
            <AlertTriangle size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
        </span>
        <span className="tool-event-copy min-w-0 flex-1">
          <span>
            <strong>{title}</strong>
            <small className="tool-entry-badge">
              {status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '进行中'}
            </small>
          </span>
          {detailValue !== undefined && <code>{String(detailValue)}</code>}
        </span>
        <ChevronRight
          className="tool-event-action tool-entry-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="tool-event-detail tool-entry-detail border-t border-[hsl(var(--border))]/35 px-3 py-2">
        <Link to="?view=activity">
          <Wrench size={12} aria-hidden="true" /> 在工具检查器中查看
        </Link>
      </div>
    </details>
  );
}

function toolEventStatusValue(event: EventRecord): 'failed' | 'completed' | 'running' {
  return event.type.endsWith('.failed')
    ? 'failed'
    : event.type.endsWith('.completed')
      ? 'completed'
      : 'running';
}

function toolEventStatus(event: EventRecord): string {
  const status = toolEventStatusValue(event);
  return status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '进行中';
}

function toolEventTitle(event: EventRecord): string {
  const rawTool = event.payloadJson.tool ?? event.payloadJson.name;
  return String(
    event.payloadJson.title ??
      (rawTool === undefined
        ? event.type === 'agent.plan.updated'
          ? '更新执行计划'
          : '调用工具'
        : labelToolName(String(rawTool))),
  );
}

function toolEventDetail(event: EventRecord): string | undefined {
  const value =
    event.payloadJson.command ??
    event.payloadJson.path ??
    event.payloadJson.query ??
    event.payloadJson.url ??
    readToolLocation(event.payloadJson.locations) ??
    event.payloadJson.kind;
  return value === undefined ? undefined : String(value);
}

function ThoughtEventRow({
  thought,
  running,
}: {
  thought: ConversationTimelineItem & { kind: 'thought' };
  running: boolean;
}) {
  const duration = Math.max(0, Date.parse(thought.updatedAt) - Date.parse(thought.createdAt));
  const label = running ? '正在思考' : `思考了 ${formatThoughtDuration(duration)}`;
  return (
    <details
      className={`thought-event-row tool-entry-motion tool-entry-card mx-auto my-1 w-full max-w-3xl overflow-hidden rounded-lg${running ? ' running tool-entry-card--active' : ''}`}
    >
      <summary
        className="tool-entry-trigger tool-entry-trigger--interactive rounded-lg px-2.5 py-1.5"
        aria-label={running ? '正在思考，展开思考过程' : '展开思考过程'}
      >
        <span
          className="thought-event-pulse tool-entry-icon flex h-5 w-5 items-center justify-center rounded-md"
          aria-hidden="true"
        >
          {running ? (
            <>
              <i />
              <i />
              <i />
            </>
          ) : (
            <Brain className="h-3 w-3 text-[hsl(var(--primary))]" />
          )}
        </span>
        <strong className="tool-entry-badge text-[hsl(var(--primary))]">{label}</strong>
        <ChevronRight
          className="thought-event-action tool-entry-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="thought-event-content tool-entry-detail message-markdown break-words border-t border-violet-200/50 bg-[hsl(var(--surface))]/60 px-3 py-2 text-[11.5px] leading-relaxed text-[hsl(var(--foreground-subtle))] dark:border-violet-500/15 [&_p]:m-0 [&_p+p]:mt-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[hsl(var(--surface-muted))] [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-[11px]">
        <RichMessage text={thought.text || 'Agent 未提供可展示的思考内容。'} />
      </div>
    </details>
  );
}

const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  apply_patch: '修改文件',
  exec_command: '运行命令',
  run_tests: '运行测试',
  search: '搜索代码',
  search_query: '搜索网页',
  open: '查看网页',
};

function labelToolName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return TOOL_LABELS[normalized] ?? value;
}

function readToolLocation(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  if (!first || typeof first !== 'object' || !('path' in first)) return undefined;
  return typeof first.path === 'string' ? first.path : undefined;
}

function formatThoughtDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

function RichMessage({ text }: { text: string }) {
  return (
    <Suspense fallback={<span className="message-markdown-loading">{text}</span>}>
      <MarkdownMessage text={text} />
    </Suspense>
  );
}
