import { FormDialog, FormTextField } from '@agenthub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { type SessionRecord } from '../../../lib/api';
import {
  beginRename,
  checkRename,
  editRename,
  getRename,
  mergeSessionTitle,
  rebaseRename,
  renameEpoch,
  saveRename,
  subscribeRename,
  validTitleRevision,
} from './sessionRenameState';
import styles from './SessionRename.module.css';

export function SessionRename({
  session,
  triggerLabel,
}: {
  session: SessionRecord;
  triggerLabel?: string | undefined;
}) {
  const mode = useAuthMode();
  const user = useAuthUser();
  const epoch = useSyncExternalStore(subscribeRename, renameEpoch);
  const scope = `${mode ?? 'unresolved'}:${user?.id ?? ''}:${session.id}`;
  const token = `${scope}:${epoch}`;
  const activeToken = useRef(token);
  activeToken.current = token;
  return (
    <ScopedSessionRename
      key={`${scope}:${epoch}`}
      scope={scope}
      isCurrent={() => activeToken.current === token && renameEpoch() === epoch}
      triggerLabel={triggerLabel}
      session={session}
      authorized={mode === 'local_trusted' || (mode === 'token' && Boolean(user?.id))}
    />
  );
}
function ScopedSessionRename({
  triggerLabel,
  scope,
  session,
  authorized,
  isCurrent,
}: {
  scope: string;
  triggerLabel?: string | undefined;
  session: SessionRecord;
  authorized: boolean;
  isCurrent: () => boolean;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const state = useSyncExternalStore(subscribeRename, () => getRename(scope));
  const alive = useRef(true);
  const inputId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const apply = async (incoming: SessionRecord) => {
    if (!alive.current || !isCurrent()) return;
    // Cancel captured pre-write reads before merging the committed metadata.
    await Promise.all([
      client.cancelQueries({ queryKey: ['session', session.id], exact: true }, { revert: false }),
      client.cancelQueries({ queryKey: ['sessions'] }, { revert: false }),
    ]);
    if (!alive.current || !isCurrent()) return;
    client.setQueryData<SessionRecord>(['session', session.id], (old) =>
      mergeSessionTitle(old, incoming),
    );
    client.setQueriesData<SessionRecord[]>({ queryKey: ['sessions'] }, (old) =>
      Array.isArray(old) ? old.map((item) => mergeSessionTitle(item, incoming) ?? item) : old,
    );
  };
  const locked = state?.phase !== 'editing' || state.revision >= 2147483647;
  const busy = state?.phase === 'pending' || state?.phase === 'checking';
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label="重命名会话"
        title="重命名会话"
        disabled={!authorized || !validTitleRevision(session.titleRevision)}
        onClick={() => {
          beginRename(scope, session);
          const saved = getRename(scope);
          if (saved?.current) void apply(saved.current).catch(() => undefined);
          setOpen(true);
        }}
      >
        <Pencil size={15} aria-hidden="true" />
        {triggerLabel && <span className={styles.triggerLabel}>{triggerLabel}</span>}
      </button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="重命名会话"
        description="仅更改显示名称，不影响 Agent、运行状态或会话排序。"
        footer={
          <div className={styles.actions}>
            <button
              type="button"
              aria-label={state?.phase === 'editing' ? undefined : '关闭重命名窗口'}
              onClick={() => setOpen(false)}
            >
              {state?.phase === 'editing' ? '取消' : '关闭'}
            </button>
            {state && ['unknown', 'conflict'].includes(state.phase) && (
              <button type="button" onClick={() => void checkRename(scope, apply)}>
                核对当前名称
              </button>
            )}
            {state &&
              ['current', 'success'].includes(state.phase) &&
              state.current?.titleRevision !== 2147483647 && (
                <button type="button" onClick={() => rebaseRename(scope)}>
                  使用当前版本继续编辑
                </button>
              )}
            {state?.phase === 'editing' && (
              <button
                type="button"
                className={styles.primary}
                disabled={locked}
                onClick={() => void saveRename(scope, apply)}
              >
                保存名称
              </button>
            )}
          </div>
        }
      >
        <div className={styles.body} aria-busy={busy}>
          <p className={styles.context}>当前会话：{session.title}</p>
          <FormTextField
            id={inputId}
            label="会话名称"
            value={state?.draft ?? session.title}
            maxLength={240}
            disabled={locked}
            onChange={(event) => editRename(scope, event.target.value)}
          />
          {state && ['pending', 'unknown', 'checking', 'conflict'].includes(state.phase) && (
            <p className={styles.message}>关闭仅收起此窗口，不会撤销原请求，也不会重复提交。</p>
          )}
          {state?.message && (
            <p role="status" className={styles.message}>
              {state.message}
            </p>
          )}
          {state?.current && (
            <div className={styles.current}>
              <span>{state.phase === 'success' ? '本次保存返回的名称' : '本次核对返回的名称'}</span>
              <strong>{state.current.title}</strong>
            </div>
          )}
          {state &&
            (state.revision >= 2147483647 || state.current?.titleRevision === 2147483647) && (
              <p role="status">名称版本已达上限，不能继续重命名。</p>
            )}
        </div>
      </FormDialog>
    </>
  );
}
