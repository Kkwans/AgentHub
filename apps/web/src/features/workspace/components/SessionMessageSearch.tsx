import { Search, X, ArrowUpRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { MessageQueryState } from '../workspace-types';
import type { SavedMessageTarget } from '../sessionMessageSearch';
import { useMessageSearchScope, useSessionMessageSearch } from '../useSessionMessageSearch';
import styles from './SessionMessageSearch.module.css';
export function SessionMessageSearch(props: {
  sessionId: string;
  host: HTMLElement | null;
  messages: MessageQueryState;
  onLocate: (target: SavedMessageTarget, signal: AbortSignal) => Promise<void>;
}) {
  const { scope, authorized } = useMessageSearchScope(props.sessionId);
  return <ScopedSearch key={scope} {...props} authorized={authorized} />;
}
function ScopedSearch({
  sessionId,
  host,
  messages,
  onLocate,
  authorized,
}: {
  sessionId: string;
  host: HTMLElement | null;
  messages: MessageQueryState;
  onLocate: (target: SavedMessageTarget, signal: AbortSignal) => Promise<void>;
  authorized: boolean;
}) {
  const {
    open,
    input,
    page,
    hits,
    busy,
    locating,
    status,
    continuation,
    trigger,
    textbox,
    revoked,
    close,
    search,
    locate,
    toggle,
    changeInput,
    cancelLocation,
  } = useSessionMessageSearch({ sessionId, host, messages, onLocate, authorized });
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label="搜索已保存文字"
        aria-expanded={open}
        disabled={!authorized}
        onClick={toggle}
      >
        <Search size={16} />
      </button>
      {open && host
        ? createPortal(
            <section
              className={styles.panel}
              aria-label="当前会话文字搜索"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  close();
                }
              }}
            >
              <div className={styles.heading}>
                <strong>已保存文字</strong>
                <span>仅当前会话 · 用户与 Agent</span>
                <button type="button" aria-label="关闭搜索" onClick={close}>
                  <X size={16} />
                </button>
              </div>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void search();
                }}
              >
                <Search size={15} aria-hidden="true" />
                <input
                  ref={textbox}
                  aria-label="搜索已保存文字"
                  value={input}
                  maxLength={200}
                  placeholder="查找会话中的文字…"
                  onChange={(event) => changeInput(event.target.value)}
                />
                <button type="submit" disabled={busy || locating || !input.trim() || revoked}>
                  搜索
                </button>
              </form>
              <p className={styles.scope}>不包含实时流、思考、工具、审批或附件。</p>
              {hits.length ? (
                <ol className={styles.results}>
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        aria-label={'定位消息 ' + hit.id}
                        disabled={locating || busy || !messages.locateMessage}
                        onClick={() => void locate(hit)}
                      >
                        <span className={styles.meta}>
                          <strong>{hit.role === 'USER' ? '你' : 'Agent'}</strong>
                          <time dateTime={hit.createdAt}>
                            {new Date(hit.createdAt).toLocaleString('zh-CN')}
                          </time>
                          <ArrowUpRight size={14} />
                        </span>
                        <span className={styles.snippet}>{hit.snippet}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className={styles.footer}>
                <p role="status">{status}</p>
                {page && !page.exhausted ? (
                  <button
                    type="button"
                    disabled={busy || locating}
                    onClick={() => void search(true)}
                  >
                    继续搜索
                  </button>
                ) : null}
                {continuation ? (
                  <button type="button" onClick={() => void locate(continuation)}>
                    继续加载历史
                  </button>
                ) : null}
                {locating || continuation ? (
                  <button type="button" onClick={cancelLocation}>
                    取消定位
                  </button>
                ) : null}
              </div>
            </section>,
            host,
          )
        : null}
    </>
  );
}
