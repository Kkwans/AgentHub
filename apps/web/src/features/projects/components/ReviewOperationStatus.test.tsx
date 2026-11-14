// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../../lib/api';
import type { ReviewOperationOwner } from '../lib/review-operation-owner';
import { ReviewOperationProvider, useReviewOperations } from './ReviewOperationProvider';
import { ReviewOperationStatus } from './ReviewOperationStatus';
const auth = vi.hoisted(() => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'token',
  useAuthUser: () => ({ id: auth.id }),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  auth.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
});
const identity = { projectId: 'p', taskId: 't', executionId: 'e' };
const execution = {
  id: 'e',
  projectId: 'p',
  taskId: 't',
  status: 'REVIEW',
  runId: 'run',
  worktreePath: '/worktree',
  baseSha: 'base',
  taskBranch: 'branch',
};
const review = {
  worktreePath: '/worktree',
  baseSha: 'base',
  taskBranch: 'branch',
  mergeAdmission: {
    expectedRunId: 'run',
    expectedOperationId: 'target',
    dispatchOperationId: 'next',
    retryEligible: true,
    mergeAllowed: true,
  },
};
function mount(proof = true) {
  let owner!: ReviewOperationOwner;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  function Probe() {
    owner = useReviewOperations()!.owner;
    return null;
  }
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReviewOperationProvider>
          <Probe />
          <ReviewOperationStatus />
        </ReviewOperationProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  act(() => {
    const bound = owner.bind(identity);
    const pending = {
      ...identity,
      operationId: 'ui-operation',
      phase: 'pending' as const,
      message: 'pending',
      ...(proof ? { gitMergeAttempt: { runId: 'run', operationId: 'target' } } : {}),
    };
    bound.onOperationChange(pending);
    bound.onOperationChange({ ...pending, phase: 'unknown' });
  });
  return {
    owner: () => owner,
    auth: (id: string) => {
      auth.id = id;
      view.rerender(tree());
    },
  };
}
it('global owner recovers exact merge rejection after child unmount without retrying POST', async () => {
  const app = mount();
  const post = vi.spyOn(api, 'post');
  vi.spyOn(api, 'get').mockImplementation(
    async (path) => (path.endsWith('/review') ? review : execution) as never,
  );
  fireEvent.click(screen.getByRole('button', { name: '核对原操作' }));
  await waitFor(() => expect(app.owner().getSnapshot()[0]?.phase).toBe('retryable'));
  expect(post).not.toHaveBeenCalled();
});
it.each([
  'other-run',
  'other-operation',
  'missing',
  'malformed',
  'unknown',
  'wrong-path',
  'no-proof',
])('%s cannot release the persisted owner lock', async (mode) => {
  const app = mount(mode !== 'no-proof');
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (!path.endsWith('/review')) return execution as never;
    if (mode === 'missing') throw new Error('404');
    if (mode === 'malformed') return { mergeAdmission: review.mergeAdmission } as never;
    return {
      ...review,
      ...(mode === 'wrong-path' ? { worktreePath: '/other' } : {}),
      mergeAdmission: {
        ...review.mergeAdmission,
        expectedRunId: mode === 'other-run' ? 'other' : 'run',
        expectedOperationId: mode === 'other-operation' ? 'other' : 'target',
        retryEligible: mode !== 'unknown',
      },
    } as never;
  });
  fireEvent.click(screen.getByRole('button', { name: '核对原操作' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '核对原操作' })).not.toBeDisabled(),
  );
  expect(app.owner().getSnapshot()[0]?.phase).toBe('unknown');
});
it('late matching proof after auth ABA cannot release a new owner operation', async () => {
  const app = mount();
  let resolve!: (value: unknown) => void;
  const pending = new Promise((yes) => {
    resolve = yes;
  });
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(async (path) =>
      path.endsWith('/review') ? ((await pending) as never) : (execution as never),
    );
  fireEvent.click(screen.getByRole('button', { name: '核对原操作' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  app.auth('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  app.auth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  act(() => {
    const bound = app.owner().bind(identity);
    const snapshot = {
      ...identity,
      operationId: 'ui-operation',
      phase: 'pending' as const,
      message: 'new',
    };
    bound.onOperationChange(snapshot);
    bound.onOperationChange({ ...snapshot, phase: 'unknown' });
  });
  await act(async () => resolve(review));
  expect(app.owner().getSnapshot()[0]?.phase).toBe('unknown');
  expect(app.owner().getSnapshot()[0]?.gitMergeAttempt).toBeUndefined();
});

it('auth ABA while first GET is pending prevents the old second review request', async () => {
  const app = mount();
  let resolve!: (value: unknown) => void;
  const get = vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对原操作' }));
  expect(get).toHaveBeenCalledTimes(1);
  app.auth('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  app.auth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await act(async () => resolve(execution));
  expect(get).toHaveBeenCalledTimes(1);
  expect(app.owner().getSnapshot()).toEqual([]);
});
