/**
 * ChatEntryRenderer — direct source split from PinHarness
 * components/run/chat/ChatEntryRenderer.tsx.
 *
 * This file owns only the source renderer routing and visual entry cards. The
 * normalized AgentHub ConversationTimelineItem adapter remains the boundary.
 */

import {
  AlertTriangle,
  Button,
  CheckCircle2,
  ChevronRight,
  Copy,
  LoaderCircle,
  ListChecks,
  ShieldCheck,
  Wrench,
} from '@agenthub/ui';
import { lazy, memo, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';

import type { EventRecord } from '../../../lib/api';
import { labelApprovalStatus, presentAgentMessage } from '../../../presentation/domain-labels';
import type {
  ConversationApprovalItem,
  ConversationPlanItem,
  ConversationToolGroup,
  ConversationTimelineItem,
} from './conversationModel';
import { SubagentEntry } from './pinharness-chat/entries/SubagentEntry';
import { AssistantMessageEntry } from './pinharness-chat/entries/AssistantMessageEntry';
import { ThinkingEntry } from './pinharness-chat/entries/ThinkingEntry';
import { ToolUseEntry } from './pinharness-chat/entries/ToolUseEntry';
import type {
  PinHarnessConversationEntry,
  PinHarnessDisplayEntry,
  PinHarnessToolStatus,
} from './pinharness-chat/types';
import { resolveToolTheme } from './pinharness-chat/toolThemes';

const MarkdownMessage = lazy(() => import('./MarkdownMessage'));

/** PinHarness source name: route every display entry without reordering protocol events. */
export type ChatEntryRendererProps = {
  item: ConversationTimelineItem | ConversationToolGroup;
  resolving: string | undefined;
  resolveError: Error | undefined;
  resolveVariables: { id: string; optionId: string } | undefined;
  activeThoughtId: string | undefined;
  onResolve: (variables: { id: string; optionId: string }) => void;
  onOpenFile?: ((path: string) => void) | undefined;
  onOpenDiff?: ((path: string) => void) | undefined;
};

function ChatEntryRendererView({
  item,
  resolving,
  resolveError,
  resolveVariables,
  activeThoughtId,
  onResolve,
  onOpenFile,
  onOpenDiff,
}: ChatEntryRendererProps) {
  if (item.kind === 'tool-group') {
    return (
      <ToolExecutionGroupRow events={item.events} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} />
    );
  }
  if (item.kind === 'plan') return <PlanEventRow plan={item} />;
  if (item.kind === 'tool') {
    return <ToolEventRow event={item.event} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} />;
  }
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
    return <ThinkingEntry entry={toPinHarnessThoughtEntry(item, item.id === activeThoughtId)} />;
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
        ) : message.role === 'ASSISTANT' ? (
          <AssistantMessageEntry entry={toPinHarnessMessageEntry(item, presentation.text)} />
        ) : (
          <div
            className={`message-body message-markdown min-w-0 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:m-0 [&_p+p]:mt-3 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[hsl(var(--border-strong))] [&_blockquote]:pl-3 [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[hsl(var(--border))] [&_pre]:bg-[hsl(var(--surface-muted))] [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_code]:font-mono [&_code]:text-[0.88em] [&_a]:text-[hsl(var(--primary))] [&_a]:underline-offset-2 hover:[&_a]:underline ${isUser ? 'max-w-full rounded-2xl rounded-tr-md border border-[hsl(var(--primary))]/18 bg-gradient-to-br from-[hsl(var(--primary))]/[0.09] to-[hsl(var(--primary))]/[0.05] px-3.5 py-2.5 shadow-[0_1px_4px_hsl(var(--foreground)/0.06)] transition-[border-color,box-shadow] duration-150 hover:border-[hsl(var(--primary))]/28 hover:shadow-[0_2px_8px_hsl(var(--primary)/0.1)]' : ''}`}
          >
            <RichMessage text={presentation.text} />
          </div>
        )}
        {!isUser && !item.streaming && presentation.kind === 'TEXT' && presentation.text.trim() ? (
          <ChatEntryActions text={presentation.text} />
        ) : null}
      </article>
    </div>
  );
}

/**
 * PinHarness source interaction: completed Agent entries expose a quiet,
 * hover/focus-revealed action row. AgentHub only carries over the copy action;
 * feedback/fullscreen actions would require a new backend contract and are
 * intentionally not invented here.
 */
function ChatEntryActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const fallback = document.createElement('textarea');
        fallback.value = text;
        fallback.setAttribute('readonly', 'true');
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        document.execCommand('copy');
        fallback.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      // Clipboard access is optional (for example in an insecure embedded WebView).
      setCopied(false);
    }
  };

  return (
    <div className="message-actions" role="toolbar" aria-label="Agent 回复快捷操作">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? '已复制回复' : '复制回复'}
        data-copied={copied || undefined}
      >
        <Copy size={13} aria-hidden="true" />
        <span aria-live="polite">{copied ? '已复制' : '复制'}</span>
      </button>
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
  if (previous.onOpenFile !== next.onOpenFile) return false;
  if (previous.onOpenDiff !== next.onOpenDiff) return false;
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

function ToolExecutionGroupRow({
  events,
  onOpenFile,
  onOpenDiff,
}: {
  events: EventRecord[];
  onOpenFile: ((path: string) => void) | undefined;
  onOpenDiff: ((path: string) => void) | undefined;
}) {
  return (
    <div className="tool-execution-group mx-auto grid w-full max-w-3xl gap-1.5">
      {events.map((event) => (
        <ToolEventRow
          key={event.id}
          event={event}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </div>
  );
}

function ToolEventRow({
  event,
  onOpenFile,
  onOpenDiff,
}: {
  event: EventRecord;
  onOpenFile: ((path: string) => void) | undefined;
  onOpenDiff: ((path: string) => void) | undefined;
}) {
  const displayEntry = toPinHarnessToolEntry(event);
  return (
    <div className="tool-event-row mx-auto w-full max-w-3xl" data-event-id={event.id}>
      {displayEntry.type === 'subagent' ? (
        <SubagentEntry entry={displayEntry} />
      ) : (
        <ToolUseEntry entry={displayEntry} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} />
      )}
      {!hasToolPayloadDetails(event) && (
        <Link
          to="?view=activity"
          className="tool-event-inspector-link inline-flex items-center gap-1 px-1 py-0.5 text-[10px] text-[hsl(var(--foreground-faint))] transition-colors hover:text-[hsl(var(--primary))]"
        >
          <Wrench size={11} aria-hidden="true" /> 在工具检查器中查看
        </Link>
      )}
    </div>
  );
}

function toolEventTitle(event: EventRecord): string {
  const rawTool = event.payloadJson.tool ?? event.payloadJson.name;
  return String(
    event.payloadJson.title ??
      (isSubagentEvent(event)
        ? '子 Agent 执行'
        : rawTool === undefined
          ? event.type === 'agent.plan.updated'
            ? '更新执行计划'
            : '调用工具'
          : labelToolName(String(rawTool))),
  );
}

/**
 * ACP currently normalizes sub-agent work as an ordinary tool call. Keep the
 * visual distinction when an adapter provides the explicit semantic marker,
 * without inventing a new WebSocket/REST event type.
 */
function isSubagentEvent(event: EventRecord): boolean {
  const payload = event.payloadJson;
  if (payload.subagent === true || payload.subAgent === true) return true;
  const kind = String(payload.kind ?? '').toLocaleLowerCase();
  if (kind === 'subagent' || kind === 'sub-agent' || kind.includes('subagent')) return true;
  const tool = String(payload.tool ?? payload.name ?? '').toLocaleLowerCase();
  return tool.includes('subagent') || tool.includes('spawn_agent') || tool.includes('delegate');
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

function hasToolPayloadDetails(event: EventRecord): boolean {
  const payload = event.payloadJson;
  if (['output', 'rawOutput', 'result'].some((key) => payload[key] !== undefined)) return true;
  return SAFE_TOOL_INPUT_KEYS.some((key) => {
    const value = payload[key];
    return value !== undefined && !['title', 'name', 'kind', 'status'].includes(key);
  });
}

function eventStatus(event: EventRecord): PinHarnessToolStatus {
  const status = typeof event.payloadJson.status === 'string' ? event.payloadJson.status : '';
  if (status === 'failed' || event.type.endsWith('.failed')) return 'failed';
  if (status === 'completed' || event.type.endsWith('.completed')) return 'completed';
  if (status === 'pending') return 'pending';
  return 'running';
}

const SAFE_TOOL_INPUT_KEYS = [
  'path',
  'paths',
  'locations',
  'command',
  'cmd',
  'script',
  'query',
  'pattern',
  'search_term',
  'url',
  'urls',
  'target_file',
  'file_path',
  'target_directory',
  'glob_pattern',
  'offset',
  'old_string',
  'new_string',
  'edits',
  'contents',
  'description',
  'prompt',
  'task',
  'subagent_type',
  'subagentType',
  'model',
  'managedProfile',
  'managedTools',
] as const;

function pickSafeToolInput(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const source = isRecord(payload.input)
    ? payload.input
    : isRecord(payload.arguments)
      ? payload.arguments
      : payload;
  const picked: Record<string, unknown> = {};
  for (const key of SAFE_TOOL_INPUT_KEYS) {
    const value = source[key];
    if (value !== undefined) picked[key] = value;
  }
  if (Object.keys(picked).length > 0) return picked;
  const location = readToolLocation(payload.locations);
  if (location) return { path: location };
  // Keep every tool call expandable, matching PinHarness's source affordance,
  // while using only the already-normalized public event name as a fallback.
  const fallbackName = payload.title ?? payload.name ?? payload.tool;
  return typeof fallbackName === 'string' ? { tool: fallbackName } : { tool: 'tool' };
}

function readToolOutput(payload: Record<string, unknown>): string | undefined {
  for (const key of ['output', 'rawOutput', 'result'] as const) {
    const value = payload[key];
    if (typeof value === 'string') return value;
    if (isRecord(value) || Array.isArray(value)) {
      try {
        return JSON.stringify(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function toPinHarnessConversationEntry(
  event: EventRecord,
  overrides: Partial<PinHarnessConversationEntry> = {},
): PinHarnessConversationEntry {
  const payload = event.payloadJson;
  const status = eventStatus(event);
  const parsedTimestamp = Date.parse(event.createdAt);
  const toolName = toolEventTitle(event);
  const rawInput = normalizeToolInput(
    `${toolName} ${typeof payload.kind === 'string' ? payload.kind : ''}`,
    pickSafeToolInput(payload),
  );
  const rawOutput = readToolOutput(payload);
  return {
    id: `tool-entry:${event.id}`,
    entryType: 'tool_use',
    content: typeof payload.description === 'string' ? payload.description : '',
    messageId: event.runId ?? event.sessionId,
    timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
    streaming: status === 'running' || status === 'pending',
    toolCallId: typeof payload.toolCallId === 'string' ? payload.toolCallId : `event-${event.id}`,
    toolTitle: toolName,
    ...(typeof payload.kind === 'string' ? { toolKind: payload.kind } : {}),
    toolStatus: status,
    ...(rawInput ? { rawInput } : {}),
    ...(rawOutput ? { rawOutput } : {}),
    ...(typeof payload.subagentId === 'string' ? { subagentId: payload.subagentId } : {}),
    ...(typeof payload.parentToolCallId === 'string'
      ? { parentToolCallId: payload.parentToolCallId }
      : {}),
    ...(typeof payload.durationMs === 'number' ? { toolDurationMs: payload.durationMs } : {}),
    ...overrides,
  };
}

function normalizeToolInput(
  toolName: string,
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const theme = resolveToolTheme(toolName);
  const location = readToolLocation(input.locations);
  if (theme === 'read' && input.target_file === undefined) {
    const target = typeof input.path === 'string' ? input.path : location;
    if (target) return { ...input, target_file: target };
  }
  if (theme === 'edit' && input.file_path === undefined) {
    const target = typeof input.path === 'string' ? input.path : location;
    if (target) return { ...input, file_path: target };
  }
  return input;
}

function readSubagentChildEntries(event: EventRecord): PinHarnessConversationEntry[] {
  const payload = event.payloadJson;
  const candidates = [payload.entries, payload.children, payload.childEntries, payload.trace];
  const rawEntries = candidates.find(Array.isArray);
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const type = value.entryType ?? value.type;
    const childEvent: EventRecord = {
      id: `${event.id}:child:${index}`,
      sessionId: event.sessionId,
      runId: event.runId,
      seq: event.seq + index,
      type: typeof type === 'string' ? type : 'tool.call.completed',
      payloadJson: value,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : event.createdAt,
    };
    const entryType =
      type === 'thinking' || type === 'assistant_message' || type === 'user_message'
        ? type
        : 'tool_use';
    return [
      toPinHarnessConversationEntry(childEvent, {
        entryType,
        content:
          typeof value.content === 'string'
            ? value.content
            : typeof value.text === 'string'
              ? value.text
              : '',
        ...(typeof value.streaming === 'boolean' ? { streaming: value.streaming } : {}),
        ...(typeof value.lastChunkTime === 'number' ? { lastChunkTime: value.lastChunkTime } : {}),
      }),
    ];
  });
}

function toPinHarnessToolEntry(event: EventRecord): PinHarnessDisplayEntry {
  const rootEntry = toPinHarnessConversationEntry(event, {
    toolTitle: isSubagentEvent(event) ? 'Agent' : toolEventTitle(event),
  });
  if (!isSubagentEvent(event)) {
    return {
      id: rootEntry.id,
      type: 'tool_use',
      entry: rootEntry,
      streaming: rootEntry.streaming,
    };
  }
  const payload = event.payloadJson;
  const description =
    (typeof payload.description === 'string' && payload.description.trim()) ||
    (typeof payload.prompt === 'string' && payload.prompt.trim()) ||
    '子 Agent 执行';
  const childEntries = readSubagentChildEntries(event);
  return {
    id: `subagent-entry:${event.id}`,
    type: 'subagent',
    streaming: rootEntry.streaming,
    subagent: {
      rootEntry,
      childEntries,
      description,
      status: rootEntry.toolStatus ?? 'running',
    },
  };
}

function toPinHarnessThoughtEntry(
  thought: ConversationTimelineItem & { kind: 'thought' },
  streaming: boolean,
): PinHarnessDisplayEntry {
  const startedAt = Date.parse(thought.createdAt);
  const updatedAt = Date.parse(thought.updatedAt);
  const timestamp = Number.isFinite(startedAt) ? startedAt : Date.now();
  return {
    id: thought.id,
    type: 'thinking',
    streaming,
    entry: {
      id: thought.id,
      entryType: 'thinking',
      content: thought.text,
      messageId: thought.runId ?? thought.id,
      timestamp,
      streaming,
      ...(Number.isFinite(updatedAt) ? { lastChunkTime: updatedAt } : {}),
    },
  };
}

function toPinHarnessMessageEntry(
  item: ConversationTimelineItem & { kind: 'message' },
  text: string,
): PinHarnessDisplayEntry {
  const parsedTimestamp = Date.parse(item.message.createdAt);
  const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();
  return {
    id: item.id,
    type: item.message.role === 'USER' ? 'user_message' : 'assistant_message',
    ...(item.streaming ? { streaming: true } : {}),
    entry: {
      id: item.message.id,
      entryType: item.message.role === 'USER' ? 'user_message' : 'assistant_message',
      content: text,
      messageId: item.message.id,
      timestamp,
      streaming: item.streaming ?? false,
    },
  };
}

function RichMessage({ text }: { text: string }) {
  return (
    <Suspense fallback={<span className="message-markdown-loading">{text}</span>}>
      <MarkdownMessage text={text} />
    </Suspense>
  );
}
