// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type PromptRecord } from '../../../lib/api';
import { authSession } from '../../../lib/auth-api';
import { usePromptVersionDraft } from './usePromptVersionDraft';
const auth = vi.hoisted(() => ({ id: 'owner' }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'token',
  useAuthUser: () => ({ id: auth.id }),
}));
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let records: PromptRecord[];
let model: ReturnType<typeof usePromptVersionDraft>;
let client: QueryClient;
const row = (id: string, type: 'TEXT' | 'CHAT' = 'TEXT') =>
  ({ id, name: `Prompt ${id}`, type }) as PromptRecord;
const result = (id: string) => ({ id: `version-${id}`, promptId: id, version: 1 });
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
beforeEach(() => {
  records = [row('A'), row('B', 'CHAT')];
  auth.id = 'owner';
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});
function Harness() {
  const { id = 'A' } = useParams();
  const navigate = useNavigate();
  model = usePromptVersionDraft(
    records.find((item) => item.id === id) ?? records[0],
    records,
    'all',
    id,
  );
  return (
    <>
      <button onClick={() => navigate('/prompts/A')}>A</button>
      <button onClick={() => navigate('/prompts/B')}>B</button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button
        onClick={() => {
          model.setVersionContent('');
          model.setVersionOpen(true);
        }}
      >
        Open
      </button>
      {model.versionOpen ? (
        <div>
          <span>{model.versionTarget?.name}</span>
          <input
            aria-label="draft"
            value={model.versionContent}
            onChange={(event) => model.setVersionContent(event.target.value)}
          />
          <button onClick={() => void model.versionCreate.mutate()}>Submit</button>
          <button onClick={() => model.setVersionOpen(false)}>Close</button>
          {model.versionOutcomeUnknown ? <span>Unknown</span> : null}
        </div>
      ) : null}
    </>
  );
}
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/prompts/A']}>
        <Routes>
          <Route path="/prompts/:id" element={<Harness />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}
function open(text = 'draft A') {
  fireEvent.click(screen.getByText('Open'));
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: text } });
}
it('route B and browser Back revoke A draft instead of changing its write target', async () => {
  mount();
  open();
  const oldSubmit = model.versionCreate.mutate;
  fireEvent.click(screen.getByText('B'));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  await act(async () => {
    await oldSubmit();
  });
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
});
it('a removed exact target cannot fall back to the first remaining asset for writing', async () => {
  const view = mount();
  open();
  const oldSubmit = model.versionCreate.mutate;
  records = [row('B')];
  view.refresh();
  await act(async () => {
    await oldSubmit();
  });
  fireEvent.click(screen.getByText('Open'));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
it('same-asset refetch retains an unsaved draft', () => {
  const view = mount();
  open();
  records = [...records];
  view.refresh();
  expect(screen.getByLabelText('draft')).toHaveValue('draft A');
});
it('late A success cannot clear B draft and only invalidates A queries', async () => {
  const pending = deferred();
  vi.mocked(api.post).mockReturnValue(pending.promise as never);
  mount();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  open();
  fireEvent.click(screen.getByText('Submit'));
  expect(api.post).toHaveBeenCalledWith(
    '/prompts/A/versions',
    expect.objectContaining({ content: { text: 'draft A' } }),
  );
  fireEvent.click(screen.getByText('B'));
  open('{"messages":[{"role":"user","content":"B"}]}');
  await act(async () => {
    pending.resolve(result('A'));
  });
  expect(screen.getByLabelText('draft')).toHaveValue(
    '{"messages":[{"role":"user","content":"B"}]}',
  );
  expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
    ['prompt-versions', 'A'],
    ['prompt-labels', 'A'],
  ]);
});
it('close/reopen owns a new draft; the old response cannot close it', async () => {
  const pending = deferred();
  vi.mocked(api.post).mockReturnValue(pending.promise as never);
  mount();
  open();
  fireEvent.click(screen.getByText('Submit'));
  fireEvent.click(screen.getByText('Close'));
  open('new draft');
  await act(async () => {
    pending.resolve(result('A'));
  });
  expect(screen.getByLabelText('draft')).toHaveValue('new draft');
});
it.each(['auth-event', 'identity', 'unmount'])(
  'revokes stale submissions and callbacks on %s',
  async (reason) => {
    const pending = deferred();
    vi.mocked(api.post).mockReturnValue(pending.promise as never);
    const view = mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    open();
    fireEvent.click(screen.getByText('Submit'));
    const oldSubmit = model.versionCreate.mutate;
    if (reason === 'auth-event') act(() => authSession.notifyAuthorizationRequired());
    if (reason === 'identity') {
      auth.id = 'other';
      view.refresh();
    }
    if (reason === 'unmount') view.unmount();
    await act(async () => {
      pending.resolve(result('A'));
      await oldSubmit();
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  },
);
it('freezes CHAT type and sends parsed actual JSON only to B', async () => {
  vi.mocked(api.post).mockResolvedValue(result('B'));
  mount();
  fireEvent.click(screen.getByText('B'));
  open('{"messages":[]}');
  await act(async () => {
    await model.versionCreate.mutate();
  });
  expect(api.post).toHaveBeenCalledWith(
    '/prompts/B/versions',
    expect.objectContaining({ content: { messages: [] } }),
  );
});
it.each([
  new Error('response lost'),
  { id: 'wrong', promptId: 'B', version: 1 },
  { id: '', promptId: 'A', version: 0 },
])('unknown outcomes fence retry and survive close/reopen: %s', async (outcome) => {
  if (outcome instanceof Error) vi.mocked(api.post).mockRejectedValue(outcome);
  else vi.mocked(api.post).mockResolvedValue(outcome);
  mount();
  open();
  await act(async () => {
    await model.versionCreate.mutate();
  });
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  await act(async () => {
    await model.versionCreate.mutate();
  });
  fireEvent.click(screen.getByText('Close'));
  open();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  await act(async () => {
    await model.versionCreate.mutate();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  vi.mocked(api.get).mockResolvedValue([result('B')]);
  await act(async () => {
    await model.checkVersionOutcome();
    model.resumeVersionEditing();
  });
  expect(model.versionOutcomeUnknown).toBeDefined();
  vi.mocked(api.get).mockResolvedValue([result('A')]);
  await act(async () => {
    await model.checkVersionOutcome();
  });
  act(() => model.resumeVersionEditing());
  expect(model.versionOutcomeUnknown).toBeUndefined();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('a late unknown result re-locks a reopened same-asset editor without clearing its newer draft', async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise((_resolve, fail) => {
    reject = fail;
  });
  vi.mocked(api.post).mockReturnValue(pending as never);
  vi.mocked(api.get).mockResolvedValue([]);
  mount();
  open();
  fireEvent.click(screen.getByText('Submit'));
  fireEvent.click(screen.getByText('Close'));
  open('newer A draft');
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  await act(async () => {
    await model.checkVersionOutcome();
  });
  act(() => model.resumeVersionEditing());
  expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  await act(async () => {
    reject(new Error('late response loss'));
  });
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  expect(screen.getByLabelText('draft')).toHaveValue('newer A draft');
  await act(async () => {
    await model.versionCreate.mutate();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
});
