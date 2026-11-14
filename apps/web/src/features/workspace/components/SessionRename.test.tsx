// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authSession, type SessionRecord } from '../../../lib/api';
import { SessionRename } from './SessionRename';
const auth = vi.hoisted(() => ({ mode: 'local_trusted', user: null as { id: string } | null }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => auth.mode,
  useAuthUser: () => auth.user,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  auth.mode = 'local_trusted';
  auth.user = null;
});
const record = (id: string, titleRevision = 0, title = 'Current name') =>
  ({ id, titleRevision, title, status: 'READY' }) as SessionRecord;
function setup(session: SessionRecord) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['session', session.id], session);
  client.setQueryData(['sessions'], [session]);
  client.setQueryData(['sessions', 'project'], [session]);
  const element = (current: SessionRecord) => (
    <QueryClientProvider client={client}>
      <SessionRename session={current} />
    </QueryClientProvider>
  );
  return { ...render(element(session)), client, element };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '重命名会话' }));
  await screen.findByLabelText('会话名称');
}
it('updates all session lists and retains draft across close/reopen while pending', async () => {
  let resolve!: (value: SessionRecord) => void;
  const patch = vi.spyOn(api, 'patch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
  );
  const view = setup(record('ui-pending'));
  await open();
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'New title' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  fireEvent.click(screen.getByRole('button', { name: '关闭重命名窗口' }));
  await open();
  expect(screen.getByLabelText('会话名称')).toHaveValue('New title');
  expect(screen.getByLabelText('会话名称')).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存名称' })).not.toBeInTheDocument();
  expect(patch).toHaveBeenCalledOnce();
  resolve(record('ui-pending', 1, 'New title'));
  await screen.findByText('会话名称已更新。');
  expect(view.client.getQueryData(['session', 'ui-pending'])).toMatchObject({
    title: 'New title',
    titleRevision: 1,
  });
  expect(view.client.getQueryData(['sessions', 'project'])).toMatchObject([
    { title: 'New title', titleRevision: 1 },
  ]);
});
it('isolates late responses after switching session', async () => {
  let resolve!: (value: SessionRecord) => void;
  vi.spyOn(api, 'patch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
  );
  const view = setup(record('old-session'));
  await open();
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'Old renamed' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  view.rerender(view.element(record('new-session')));
  resolve(record('old-session', 1, 'Old renamed'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(view.client.getQueryData(['session', 'old-session'])).toMatchObject({
    title: 'Current name',
    titleRevision: 0,
  });
  await open();
  expect(screen.getByLabelText('会话名称')).toHaveValue('Current name');
});
it('revokes late cache writes when authorization expires', async () => {
  let resolve!: (value: SessionRecord) => void;
  vi.spyOn(api, 'patch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
  );
  const view = setup(record('auth-session'));
  await open();
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'Do not leak' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  authSession.notifyAuthorizationRequired();
  resolve(record('auth-session', 1, 'Do not leak'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(view.client.getQueryData(['session', 'auth-session'])).toMatchObject({
    title: 'Current name',
  });
});
it('network uncertainty survives unmount and GET never replays PATCH', async () => {
  const patch = vi.spyOn(api, 'patch').mockRejectedValue(new Error('network'));
  const get = vi.spyOn(api, 'get').mockResolvedValue(record('unknown-ui'));
  const view = setup(record('unknown-ui'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  await screen.findByText(/保存结果尚未确认/);
  view.unmount();
  setup(record('unknown-ui'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: '核对当前名称' }));
  await screen.findByText(/当前版本未变化/);
  expect(get).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '保存名称' })).not.toBeInTheDocument();
});
it('observes authorization revocation while unmounted and retains the original unknown lock on same-user return', async () => {
  let resolve!: (value: SessionRecord) => void;
  const patch = vi.spyOn(api, 'patch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
  );
  const view = setup(record('offline-auth'));
  await open();
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'Original draft' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  view.unmount();
  authSession.notifyAuthorizationRequired();
  resolve(record('offline-auth', 1, 'Original draft'));
  await Promise.resolve();
  setup(record('offline-auth'));
  await open();
  expect(screen.getByLabelText('会话名称')).toHaveValue('Original draft');
  expect(screen.getByLabelText('会话名称')).toBeDisabled();
  expect(screen.getByText('授权已变化，保存结果需重新核对。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '保存名称' })).not.toBeInTheDocument();
  expect(patch).toHaveBeenCalledOnce();
});

it('keeps another identity out of the previous owner draft and late response', async () => {
  auth.mode = 'token';
  auth.user = { id: 'owner-a' };
  let resolve!: (value: SessionRecord) => void;
  vi.spyOn(api, 'patch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
  );
  const view = setup(record('shared-session'));
  await open();
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'Owner A draft' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  auth.user = { id: 'owner-b' };
  view.rerender(view.element(record('shared-session')));
  resolve(record('shared-session', 1, 'Owner A draft'));
  await Promise.resolve();
  await open();
  expect(screen.getByLabelText('会话名称')).toHaveValue('Current name');
  expect(view.client.getQueryData(['session', 'shared-session'])).toMatchObject({
    title: 'Current name',
    titleRevision: 0,
  });
});
it('cancels older in-flight reads so they cannot overwrite committed title metadata', async () => {
  const session = record('old-get');
  const view = setup(session);
  let resolveGet!: (value: SessionRecord) => void;
  const oldRead = view.client
    .fetchQuery({
      queryKey: ['session', session.id],
      queryFn: () =>
        new Promise<SessionRecord>((resolve) => {
          resolveGet = resolve;
        }),
    })
    .catch(() => undefined);
  vi.spyOn(api, 'patch').mockResolvedValue(record('old-get', 1, 'Committed'));
  await open();
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'Committed' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  await waitFor(() =>
    expect(view.client.getQueryData(['session', session.id])).toMatchObject({
      title: 'Committed',
      titleRevision: 1,
    }),
  );
  resolveGet(session);
  await oldRead;
  expect(view.client.getQueryData(['session', session.id])).toMatchObject({
    title: 'Committed',
    titleRevision: 1,
  });
});
it('does not revert a newer cached revision when cancelling a captured old read', async () => {
  const session = record('no-revert');
  const view = setup(session);
  let resolveGet!: (value: SessionRecord) => void;
  const oldRead = view.client
    .fetchQuery({
      queryKey: ['session', session.id],
      queryFn: () =>
        new Promise<SessionRecord>((resolve) => {
          resolveGet = resolve;
        }),
    })
    .catch(() => undefined);
  view.client.setQueryData(['session', session.id], record(session.id, 9, 'Newer title'));
  vi.spyOn(api, 'patch').mockResolvedValue(record(session.id, 1, 'My title'));
  await open();
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: 'My title' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  await screen.findByText('会话名称已更新。');
  resolveGet(session);
  await oldRead;
  expect(view.client.getQueryData(['session', session.id])).toMatchObject({
    title: 'Newer title',
    titleRevision: 9,
  });
});
it('observes failed cache synchronization on reopening a saved receipt', async () => {
  const view = setup(record('reopen-cache-error'));
  vi.spyOn(api, 'patch').mockResolvedValue(record('reopen-cache-error', 1, 'Current name'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  await screen.findByText('会话名称已更新。');
  fireEvent.click(screen.getByRole('button', { name: '关闭重命名窗口' }));
  vi.spyOn(view.client, 'cancelQueries').mockRejectedValue(new Error('local cache failed'));
  await open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('会话名称已更新。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '保存名称' })).not.toBeInTheDocument();
});
