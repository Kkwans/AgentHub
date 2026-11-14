import { FormDialog } from '@agenthub/ui';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api, authSession, type SessionRecord } from '../../../lib/api';
import {
  collectTranscript,
  formatTranscript,
  transcriptFilename,
  TRANSCRIPT_LIMITS,
} from '../sessionTranscriptExport';
import styles from './SessionTranscriptExport.module.css';

export function SessionTranscriptExport({ session }: { session: SessionRecord }) {
  const mode = useAuthMode();
  const user = useAuthUser();
  const scope = `${mode}:${user?.id ?? ''}:${session.id}`;
  const current = useRef(scope);
  current.current = scope;
  return (
    <ScopedExport
      key={scope}
      session={session}
      authorized={mode === 'local_trusted' || (mode === 'token' && Boolean(user?.id))}
      isCurrent={() => current.current === scope}
    />
  );
}
function ScopedExport({
  session,
  authorized,
  isCurrent,
}: {
  session: SessionRecord;
  authorized: boolean;
  isCurrent: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const revoked = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = authSession.onAuthorizationRequired(() => {
      revoked.current = true;
      operation.current?.abort();
      setBusy(false);
      setMessage('授权已变化，已取消导出。请重新登录后再操作。');
    });
    return () => {
      alive.current = false;
      operation.current?.abort();
      unsubscribe();
    };
  }, []);
  const cancel = () => {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setOpen(false);
  };
  const start = async () => {
    if (operation.current || !authorized || revoked.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setMessage('正在读取已持久化文字…');
    const valid = () =>
      alive.current &&
      isCurrent() &&
      !revoked.current &&
      operation.current === controller &&
      !controller.signal.aborted;
    try {
      const result = await collectTranscript(
        session.id,
        (before, signal) => {
          const params = new URLSearchParams({ limit: String(TRANSCRIPT_LIMITS.pageSize) });
          if (before !== undefined) params.set('beforeSequence', String(before));
          return api.get<unknown>(
            `/sessions/${encodeURIComponent(session.id)}/messages?${params}`,
            { signal },
          );
        },
        controller.signal,
      );
      if (!valid()) return;
      const markdown = formatTranscript(result, session, new Date().toISOString());
      const url = URL.createObjectURL(
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      try {
        anchor.href = url;
        anchor.download = transcriptFilename(session.title);
        document.body.append(anchor);
        if (valid()) anchor.click();
      } finally {
        anchor.remove();
        // Let the browser consume the download URL before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      if (valid()) setMessage('已生成文字记录并发起下载。请在分享前检查敏感信息。');
    } catch {
      if (valid()) setMessage('读取失败或超出上限，未生成文件。可重新发起只读导出。');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (alive.current && isCurrent()) setBusy(false);
      }
    }
  };
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label="导出文字记录"
        title="导出文字记录"
        disabled={!authorized}
        onClick={() => {
          setOpen(true);
          setMessage('');
        }}
      >
        <Download size={15} aria-hidden="true" />
      </button>
      <FormDialog
        open={open}
        onOpenChange={(value) => {
          if (!value) cancel();
        }}
        title="导出文字记录"
        description="下载当前会话已持久化的用户和助手文字（Markdown）。"
        footer={
          <div className={styles.actions}>
            <button type="button" onClick={cancel}>
              {busy ? '取消导出' : '关闭'}
            </button>
            <button
              type="button"
              disabled={busy || !authorized || revoked.current}
              onClick={() => void start()}
            >
              {busy ? '正在读取…' : '下载 Markdown'}
            </button>
          </div>
        }
      >
        <div className={styles.body}>
          <p>
            不含实时未保存片段、思考、工具、审批、附件和续接会话，不是完整审计记录。运行中新增的消息可能不在本次范围内。
          </p>
          <p>仅下载到本机，不会上传或发送给 Agent。文字可能包含敏感信息，分享前请检查。</p>
          <p>最多读取 10,000 条消息、400 万字符；失败或超限不会生成不完整文件。</p>
          <p role="status" aria-live="polite">
            {message}
          </p>
        </div>
      </FormDialog>
    </>
  );
}
