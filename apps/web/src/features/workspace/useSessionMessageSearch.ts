import { useEffect, useRef, useState } from 'react';
import { useAuthMode, useAuthUser } from '../../components/AccessGate';
import { api, authSession } from '../../lib/api';
import type { MessageQueryState } from './workspace-types';
import {
  parseMessageSearchPage,
  type MessageSearchHit,
  type MessageSearchPage,
  type SavedMessageTarget,
} from './sessionMessageSearch';
export function useMessageSearchScope(sessionId: string) {
  const mode = useAuthMode();
  const user = useAuthUser();
  return {
    scope: mode + ':' + (user?.id ?? '') + ':' + sessionId,
    authorized: mode === 'local_trusted' || (mode === 'token' && Boolean(user?.id)),
  };
}
export function useSessionMessageSearch({
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
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [input, setInput] = useState('');
  const [page, setPage] = useState<MessageSearchPage>();
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState('');
  const [continuation, setContinuation] = useState<MessageSearchHit>();
  const alive = useRef(false);
  const revoked = useRef(false);
  const generation = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const locatingOperation = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textbox = useRef<HTMLInputElement>(null);
  const abort = () => {
    generation.current += 1;
    operation.current?.abort();
    operation.current = null;
    locatingOperation.current?.abort();
    locatingOperation.current = null;
    setBusy(false);
    setLocating(false);
    setContinuation(undefined);
  };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = authSession.onAuthorizationRequired(() => {
      revoked.current = true;
      abort();
      setHits([]);
      setPage(undefined);
      setStatus('授权已变化，搜索已取消。');
    });
    return () => {
      alive.current = false;
      generation.current += 1;
      operation.current?.abort();
      locatingOperation.current?.abort();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (open && !compact) textbox.current?.focus();
  }, [open, compact, host]);
  const close = () => {
    abort();
    setOpen(false);
    setCompact(false);
    setHits([]);
    setPage(undefined);
    setStatus('');
    trigger.current?.focus();
  };
  const search = async (more = false) => {
    const query = input.trim();
    if (!authorized || revoked.current || operation.current || !query || query.length > 200) return;
    abort();
    const captured = generation.current;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setStatus('正在搜索已保存文字…');
    const valid = () =>
      alive.current &&
      !revoked.current &&
      !controller.signal.aborted &&
      generation.current === captured;
    try {
      const previous = more && searched === query ? page : undefined;
      if (more && (!previous || previous.exhausted || previous.nextBeforeSequence === null)) return;
      const result = parseMessageSearchPage(
        await api.post<unknown>(
          '/sessions/' + encodeURIComponent(sessionId) + '/messages/search',
          {
            query,
            ...(previous
              ? {
                  upperSequence: previous.upperSequence,
                  beforeSequence: previous.nextBeforeSequence,
                }
              : {}),
          },
          { signal: controller.signal },
        ),
        sessionId,
        previous?.upperSequence,
        previous?.nextBeforeSequence ?? undefined,
      );
      if (!valid()) return;
      const old = previous ? hits : [];
      if (
        result.hits.some((hit) =>
          old.some((item) => item.id === hit.id || item.sequence === hit.sequence),
        )
      )
        throw new Error('重复结果');
      setHits([...old, ...result.hits]);
      setPage(result);
      setSearched(query);
      setStatus(
        result.exhausted
          ? old.length + result.hits.length
            ? '已搜索到本次查询的历史边界。'
            : '已保存文字中没有匹配结果。'
          : result.hits.length
            ? '已返回一批结果，可以继续搜索更早文字。'
            : '本段未找到匹配，仍有更早文字可搜索。',
      );
    } catch {
      if (valid()) setStatus('搜索失败或响应无法确认，请重新搜索。');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (alive.current) setBusy(false);
      }
    }
  };
  const locate = async (hit: MessageSearchHit) => {
    if (!messages.locateMessage || locatingOperation.current || !authorized || revoked.current)
      return;
    const controller = new AbortController();
    locatingOperation.current = controller;
    const captured = generation.current;
    setLocating(true);
    setContinuation(undefined);
    setStatus('正在加载原消息所在历史…');
    const valid = () =>
      alive.current &&
      !revoked.current &&
      generation.current === captured &&
      !controller.signal.aborted;
    try {
      const result = await messages.locateMessage(
        hit,
        controller.signal,
        (signal) => onLocate(hit, signal),
        (count) => {
          if (valid()) setStatus('正在定位，已读取 ' + count + ' 页历史…');
        },
      );
      if (!valid()) return;
      if (result === 'budget') {
        setContinuation(hit);
        setStatus('本轮定位预算已用完，尚未定位。可以继续加载历史或取消。');
      } else {
        setStatus('已定位到原消息。');
        setCompact(true);
      }
    } catch (error) {
      if (valid()) setStatus(error instanceof Error ? error.message : '未能定位原消息，请重试。');
    } finally {
      if (locatingOperation.current === controller) {
        locatingOperation.current = null;
        if (alive.current) setLocating(false);
      }
    }
  };

  return {
    open,
    compact,
    expand: () => setCompact(false),
    input,
    page,
    hits,
    busy,
    locating,
    status,
    continuation,
    trigger,
    textbox,
    revoked: revoked.current,
    close,
    search,
    locate,
    toggle: () => (open ? close() : setOpen(true)),
    changeInput: (value: string) => {
      abort();
      setInput(value);
      setHits([]);
      setPage(undefined);
      setStatus('');
    },
    cancelLocation: () => {
      locatingOperation.current?.abort();
      locatingOperation.current = null;
      setLocating(false);
      setContinuation(undefined);
      setStatus('已取消定位，已读取历史仍保留。');
    },
  };
}
