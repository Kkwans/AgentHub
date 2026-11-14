// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, authSession, type SessionRecord } from '../../../lib/api';
import ReactMarkdown from 'react-markdown';
import { flushSync } from 'react-dom';
import { SessionSecondaryTools } from './SessionSecondaryTools';
import { formatTranscript } from '../sessionTranscriptExport';
import { SessionTranscriptExport } from './SessionTranscriptExport';
const identity = vi.hoisted(() => ({
  mode: 'local_trusted',
  user: undefined as { id: string } | undefined,
}));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => identity.mode,
  useAuthUser: () => identity.user,
}));
const session = { id: 's', title: 'Example' } as SessionRecord;
const row = {
  id: 'm',
  sessionId: 's',
  sequence: 1,
  role: 'USER',
  text: 'hello',
  createdAt: '2026-01-01T00:00:00Z',
};
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  identity.mode = 'local_trusted';
  identity.user = undefined;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:download'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = () => {
  fireEvent.click(screen.getByRole('button', { name: '导出文字记录' }));
  fireEvent.click(screen.getByRole('button', { name: '下载 Markdown' }));
};
it('reads only after explicit action, downloads all pages without writes', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
  const post = vi.spyOn(api, 'post');
  render(<SessionTranscriptExport session={session} />);
  expect(get).not.toHaveBeenCalled();
  open();
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledTimes(2);
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('发起下载');
});
it('never downloads a partial result or displays raw read errors', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce([row])
    .mockRejectedValueOnce(new Error('private-token'));
  render(<SessionTranscriptExport session={session} />);
  open();
  await screen.findByText('读取失败或超出上限，未生成文件。可重新发起只读导出。');
  expect(click).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent('private-token');
});
it.each(['route', 'identity', 'revoke', 'unmount', 'cancel'])(
  'blocks late download after %s',
  async (change) => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => {
      resolve = done;
    });
    const get = vi.spyOn(api, 'get').mockImplementation(() => pending as never);
    const view = render(<SessionTranscriptExport session={session} />);
    open();
    const options = get.mock.calls[0]?.[1];
    if (change === 'route')
      view.rerender(<SessionTranscriptExport session={{ ...session, id: 'other' }} />);
    if (change === 'identity') {
      identity.mode = 'token';
      identity.user = { id: 'other' };
      view.rerender(<SessionTranscriptExport session={session} />);
    }
    if (change === 'revoke') authSession.notifyAuthorizationRequired();
    if (change === 'unmount') view.unmount();
    if (change === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消导出' }));
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => {
      resolve([]);
      await pending;
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  },
);

it('uses the real API envelope and aborts on the real authorization event from HTTP 401', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [row], requestId: 'r' }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'private-server-error' } }),
        { status: 401 },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  render(<SessionTranscriptExport session={session} />);
  open();
  await screen.findByText('授权已变化，已取消导出。请重新登录后再操作。');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[0]).toContain('/api/v1/sessions/s/messages?limit=200');
  expect(fetcher.mock.calls[1]?.[0]).toContain('beforeSequence=1');
  expect(click).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent('private-server-error');
});

it('parses the entire download with the production Markdown parser without escaping literal blocks', () => {
  const hostile =
    '<img src=x onerror=alert(1)>\n[external](https://example.test)\n```\n# forged heading\n~~~';
  const markdown = formatTranscript(
    {
      upperSequence: 2,
      rows: [
        { ...row, text: hostile },
        { ...row, id: 'm2', sequence: 2, role: 'ASSISTANT', text: 'later message' },
      ],
    },
    { id: 's', title: hostile },
    '2026-01-01T00:00:00Z',
  );
  const view = render(<ReactMarkdown>{markdown}</ReactMarkdown>);
  const blocks = [...view.container.querySelectorAll('pre > code')];
  expect(blocks.map((block) => block.textContent)).toEqual([
    hostile + '\n',
    's\n',
    hostile + '\n',
    'later message\n',
  ]);
  expect(view.container.querySelector('img, a, script')).toBeNull();
  expect([...view.container.querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual([
    'AgentHub 会话文字记录',
  ]);
  expect(view.container.querySelectorAll('h2')).toHaveLength(2);
});

it.each(['dialog', 'body-after-download'] as const)(
  '真实导出弹窗在Escape capture关闭后，同事件不能再收起更多菜单 %s',
  async (target) => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(
      <SessionSecondaryTools sessionId="s">
        <SessionTranscriptExport session={session} />
      </SessionSecondaryTools>,
    );
    const more = screen.getByRole('button', { name: '更多会话操作' });
    fireEvent.click(more);
    const trigger = screen.getByRole('button', { name: '导出文字记录' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '导出文字记录' });
    if (target === 'body-after-download') {
      vi.spyOn(api, 'get').mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      fireEvent.click(screen.getByRole('button', { name: '下载 Markdown' }));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      await screen.findByText('已生成文字记录并发起下载。请在分享前检查敏感信息。');
    }
    // Model the browser's listener checkpoint: the modal can commit its close
    // before the outer document bubble listener sees this same native event.
    const closeAtCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        flushSync(() => fireEvent.click(screen.getByText('关闭', { exact: true })));
    };
    document.addEventListener('keydown', closeAtCapture, true);
    try {
      fireEvent.keyDown(target === 'dialog' ? dialog : document.body, { key: 'Escape' });
    } finally {
      document.removeEventListener('keydown', closeAtCapture, true);
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(click).toHaveBeenCalledTimes(target === 'dialog' ? 0 : 1);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveFocus();
  },
);
