import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, type SessionRecord } from '../../../lib/api';
import {
  beginRename,
  checkRename,
  editRename,
  getRename,
  mergeSessionTitle,
  rebaseRename,
  saveRename,
} from './sessionRenameState';
const session = (id: string, revision = 3, title = 'Original') =>
  ({
    id,
    title,
    titleRevision: revision,
    status: 'READY',
    lastActiveAt: 'unchanged',
  }) as SessionRecord;
afterEach(() => vi.restoreAllMocks());
function prepare(key: string) {
  beginRename(key, session(key));
  editRename(key, '  New name  ');
}
it('sends one CAS with trim and confirms exact response only', async () => {
  prepare('success');
  let resolve!: (value: SessionRecord) => void;
  const patch = vi.spyOn(api, 'patch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
  );
  const apply = vi.fn();
  const pending = saveRename('success', apply);
  await saveRename('success', apply);
  expect(patch).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledWith('/sessions/success/title', {
    title: 'New name',
    expectedRevision: 3,
  });
  resolve(session('success', 4, 'New name'));
  await pending;
  expect(getRename('success')?.phase).toBe('success');
  expect(apply).toHaveBeenCalledOnce();
});
it('keeps unknown across remount/open and same-version reads without replay', async () => {
  prepare('unknown');
  const patch = vi.spyOn(api, 'patch').mockRejectedValue(new TypeError('network'));
  await saveRename('unknown', vi.fn());
  beginRename('unknown', session('unknown', 90, 'ignored'));
  expect(getRename('unknown')).toMatchObject({
    revision: 3,
    draft: '  New name  ',
    phase: 'unknown',
  });
  vi.spyOn(api, 'get').mockResolvedValue(session('unknown'));
  await checkRename('unknown', vi.fn());
  await saveRename('unknown', vi.fn());
  expect(getRename('unknown')?.phase).toBe('unknown');
  expect(patch).toHaveBeenCalledOnce();
});
it('higher version is current state, never evidence attributing the original write', async () => {
  prepare('higher');
  const patch = vi.spyOn(api, 'patch').mockRejectedValue(new Error('network'));
  await saveRename('higher', vi.fn());
  const apply = vi.fn();
  vi.spyOn(api, 'get').mockResolvedValue(session('higher', 4, 'New name'));
  await checkRename('higher', apply);
  expect(getRename('higher')?.phase).toBe('current');
  expect(getRename('higher')?.message).toContain('无法确认是否由本次请求写入');
  await saveRename('higher', apply);
  expect(patch).toHaveBeenCalledOnce();
  rebaseRename('higher');
  expect(getRename('higher')).toMatchObject({
    revision: 4,
    phase: 'editing',
    draft: '  New name  ',
  });
});
it.each([
  session('other', 4, 'New name'),
  session('mismatch', 3, 'New name'),
  session('mismatch', 4, 'Wrong'),
])('mismatched response remains unknown', async (response) => {
  const key = `mismatch-${JSON.stringify(response)}`;
  beginRename(key, session('mismatch'));
  editRename(key, 'New name');
  vi.spyOn(api, 'patch').mockResolvedValue(response);
  const apply = vi.fn();
  await saveRename(key, apply);
  expect(getRename(key)?.phase).toBe('unknown');
  expect(apply).not.toHaveBeenCalled();
});
it('409 permits only reading current state before explicit rebase', async () => {
  prepare('conflict');
  vi.spyOn(api, 'patch').mockRejectedValue(new ApiError('SESSION_TITLE_CONFLICT', 'conflict', 409));
  await saveRename('conflict', vi.fn());
  expect(getRename('conflict')?.phase).toBe('conflict');
});
it('never guesses missing revision or overflows the CAS range', async () => {
  const missing = session('missing');
  delete missing.titleRevision;
  beginRename('missing', missing);
  expect(getRename('missing')).toBeUndefined();
  beginRename('max', session('max', 2147483647));
  const patch = vi.spyOn(api, 'patch');
  await saveRename('max', vi.fn());
  expect(patch).not.toHaveBeenCalled();
});
it('updates only matching metadata and preserves newer revisions and runtime state', () => {
  const old = session('cache', 8, 'Latest');
  expect(mergeSessionTitle(old, session('cache', 7, 'Stale'))).toBe(old);
  expect(mergeSessionTitle(old, session('other', 9, 'Wrong'))).toBe(old);
  expect(
    mergeSessionTitle(old, {
      ...session('cache', 9, 'Fresh'),
      status: 'CLOSED',
      lastActiveAt: 'wrong',
    }),
  ).toEqual({ ...old, title: 'Fresh', titleRevision: 9 });
});
it('a local cache failure does not erase confirmed success or allow replay', async () => {
  prepare('cache-error');
  const patch = vi.spyOn(api, 'patch').mockResolvedValue(session('cache-error', 4, 'New name'));
  await saveRename('cache-error', async () => {
    throw new Error('cache failed');
  });
  expect(getRename('cache-error')?.phase).toBe('success');
  expect(getRename('cache-error')?.message).toContain('已保存');
  await saveRename('cache-error', vi.fn());
  expect(patch).toHaveBeenCalledOnce();
});
it.each(['save', 'check'])(
  'late %s cache failure cannot overwrite a rebased draft or next pending request',
  async (action) => {
    const key = `cache-rebase-${action}`;
    prepare(key);
    const patch = vi.spyOn(api, 'patch');
    if (action === 'check') {
      patch.mockRejectedValueOnce(new Error('network'));
      await saveRename(key, vi.fn());
    }
    patch.mockResolvedValueOnce(session(key, 4, 'New name'));
    vi.spyOn(api, 'get').mockResolvedValue(session(key, 4, 'New name'));
    let rejectApply!: (reason: unknown) => void;
    const first = (action === 'save' ? saveRename : checkRename)(
      key,
      () =>
        new Promise<void>((_, reject) => {
          rejectApply = reject;
        }),
    );
    await vi.waitFor(() =>
      expect(getRename(key)?.phase).toBe(action === 'save' ? 'success' : 'current'),
    );
    rebaseRename(key);
    editRename(key, 'Second draft');
    let resolveNext!: (value: SessionRecord) => void;
    patch.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve as typeof resolveNext;
        }),
    );
    const second = saveRename(key, vi.fn());
    rejectApply(new Error('late cache failure'));
    await first;
    expect(getRename(key)).toMatchObject({ phase: 'pending', revision: 4, draft: 'Second draft' });
    resolveNext(session(key, 5, 'Second draft'));
    await second;
  },
);
