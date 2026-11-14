import { GitCommitOperationProvider } from '../components/GitCommitOperationProvider';
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { WorkspacePage } from './WorkspacePage';

vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));

const listeners = vi.hoisted(() => new Map<string, () => void>());
vi.mock('../../../lib/realtime', () => ({
  realtime: {
    subscribe: (topic: string, callback: () => void) => {
      listeners.set(topic, callback);
      return () => {
        listeners.delete(topic);
      };
    },
  },
}));

const session = {
  id: 'session-1',
  projectId: '11111111-1111-4111-8111-111111111111',
  agentId: 'agent-1',
  taskId: null,
  externalSessionId: 'external-session',
  title: '可靠性回归',
  cwd: '/volume2/Project/AgentHub',
  branch: 'main',
  status: 'READY',
  model: null,
  mode: null,
  lastSeq: 0,
  createdAt: '2026-08-11T00:00:00.000Z',
  startedAt: null,
  lastActiveAt: null,
  closedAt: null,
  archivedAt: null,
};

const project = {
  id: session.projectId,
  name: 'AgentHub',
  description: null,
  targetId: 'target-1',
  rootPath: session.cwd,
  realRootPath: session.cwd,
  repoKind: 'GIT',
  status: 'ACTIVE',
};

const agent = {
  id: session.agentId,
  targetId: project.targetId,
  name: 'Codex 主力',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  status: 'READY',
  enabled: true,
  detectedVersion: '1.1.14',
  defaultModel: null,
  defaultMode: null,
  capabilitiesJson: { configuration: { models: true, modes: true } },
  lastPreflightAt: '2026-08-11T00:00:00.000Z',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data, requestId: 'workspace-page-test' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderWorkspace(
  fetchMock: typeof fetch,
  initialEntry = `/sessions/${session.id}`,
  cachedSession?: typeof session,
  precache = true,
) {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cachedSession && precache) client.setQueryData(['session', cachedSession.id], cachedSession);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {cachedSession ? <Link to={`/workspace/${cachedSession.id}`}>切换已缓存会话</Link> : null}
        <GitCommitOperationProvider>
          <Routes>
            <Route path="/sessions/:id" element={<WorkspacePage />} />
            <Route path="/workspace/:id" element={<WorkspacePage />} />
          </Routes>
        </GitCommitOperationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function baseFetch(path: string, method?: string) {
  if (path === `/api/v1/sessions/${session.id}`) return jsonResponse(session);
  if (path === '/api/v1/sessions') return jsonResponse([session]);
  if (path === '/api/v1/projects') return jsonResponse([project]);
  if (path === '/api/v1/agents') return jsonResponse([agent]);
  if (path === '/api/v1/settings/capabilities') {
    return jsonResponse({ terminal: { available: false } });
  }
  if (path === '/api/v1/prompt-context/resolve' && method === 'POST') {
    return jsonResponse({ ready: true, finalContext: '', missingVariables: [], items: [] });
  }
  if (path.startsWith(`/api/v1/sessions/${session.id}/messages`)) return jsonResponse([]);
  if (path === `/api/v1/sessions/${session.id}/runs`) return jsonResponse([]);
  if (path === `/api/v1/sessions/${session.id}/events?afterSeq=0&limit=500`) {
    return jsonResponse([]);
  }
  if (path === `/api/v1/approvals?sessionId=${session.id}`) return jsonResponse([]);
  if (path === `/api/v1/projects/${project.id}/files?depth=4`) return jsonResponse([]);
  if (path === `/api/v1/projects/${project.id}/git/diff`) {
    return jsonResponse({ patch: '', truncated: false });
  }
  if (path === `/api/v1/projects/${project.id}/git/status`) {
    return jsonResponse({ branch: 'main', headSha: null, clean: true, entries: [] });
  }
  if (path === `/api/v1/projects/${project.id}/git/diff?staged=false`) {
    return jsonResponse({ patch: '', truncated: false, staged: false });
  }
  if (path === `/api/v1/projects/${project.id}/git/diff?staged=true`) {
    return jsonResponse({ patch: '', truncated: false, staged: true });
  }
  if (path === `/api/v1/projects/${project.id}/git/commits?limit=30`) return jsonResponse([]);
  if (path === `/api/v1/projects/${project.id}/git/branches`) return jsonResponse([]);
  return jsonResponse({});
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  listeners.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function tick(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
it('reconciles a terminal event that first reads RUNNING, without a second push, and unlocks only after authoritative READY', async () => {
  vi.useFakeTimers();
  let status = 'RUNNING';
  let runStatus = 'RUNNING';
  let detailReads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === `/api/v1/sessions/${session.id}`) {
      detailReads++;
      return jsonResponse({ ...session, status });
    }
    if (path === `/api/v1/sessions/${session.id}/runs`)
      return jsonResponse([{ id: 'run-1', sessionId: session.id, status: runStatus }]);
    return baseFetch(path, init?.method);
  });
  renderWorkspace(fetchMock);
  await tick();
  runStatus = 'COMPLETED';
  await act(async () => {
    listeners.get(`session:${session.id}`)?.();
  });
  await tick();
  const composer = screen.getByRole('textbox', { name: /给 Agent 发送工程指令/ });
  expect(composer).toBeDisabled();
  const before = detailReads;
  status = 'READY';
  await tick(3_050);
  expect(detailReads).toBeGreaterThan(before);
  expect(composer).toBeEnabled();
  const settled = detailReads;
  await tick(6_050);
  expect(detailReads).toBe(settled);
});
it.each(['CLOSED', 'FAILED', 'DISCONNECTED', 'UNKNOWN'])(
  'does not infer READY or keep polling stable/unknown state %s',
  async (status) => {
    vi.useFakeTimers();
    let reads = 0;
    renderWorkspace(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === `/api/v1/sessions/${session.id}`) {
          reads++;
          return jsonResponse({ ...session, status });
        }
        return baseFetch(path, init?.method);
      }),
    );
    await tick();
    const settled = reads;
    await tick(6_050);
    expect(reads).toBe(settled);
  },
);
it('aborts an old session reconciliation when routing away and never applies its late result to the new session', async () => {
  vi.useFakeTimers();
  const other = { ...session, id: 'session-2', title: 'Other session' };
  let reads = 0;
  let signal: AbortSignal | null | undefined;
  let resolveOld!: (response: Response) => void;
  const client = renderWorkspace(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/sessions/${session.id}`) {
        reads++;
        if (reads > 1) {
          signal = init?.signal;
          return new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        }
        return jsonResponse({ ...session, status: 'RUNNING' });
      }
      if (path === `/api/v1/sessions/${other.id}`) return jsonResponse(other);
      if (path === `/api/v1/approvals?sessionId=${other.id}`) return jsonResponse([]);
      if (path.startsWith(`/api/v1/sessions/${other.id}/`)) return jsonResponse([]);
      return baseFetch(path, init?.method);
    }),
    `/sessions/${session.id}`,
    other,
  );
  await tick();
  await tick(3_050);
  expect(signal?.aborted).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: '切换已缓存会话' }));
  await tick();
  expect(signal?.aborted).toBe(true);
  resolveOld(jsonResponse({ ...session, status: 'DISCONNECTED' }));
  await tick();
  expect(client.getQueryData(['session', other.id])).toMatchObject({
    id: other.id,
    status: 'READY',
  });
  expect(screen.getByRole('textbox', { name: '给 Agent 发送工程指令' })).toBeEnabled();
});
it('aborts an in-flight reconciliation on authentication-boundary unmount', async () => {
  vi.useFakeTimers();
  let reads = 0;
  let signal: AbortSignal | null | undefined;
  let resolveOld!: (response: Response) => void;
  const client = renderWorkspace(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/sessions/${session.id}`) {
        if (++reads > 1) {
          signal = init?.signal;
          return new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        }
        return jsonResponse({ ...session, status: 'RUNNING' });
      }
      return baseFetch(path, init?.method);
    }),
  );
  await tick();
  await tick(3_050);
  cleanup();
  expect(signal?.aborted).toBe(true);
  client.removeQueries({ queryKey: ['session', session.id] });
  resolveOld(jsonResponse({ ...session, status: 'READY' }));
  await tick();
  expect(client.getQueryData(['session', session.id])).toBeUndefined();
  const stopped = reads;
  await tick(6_050);
  expect(reads).toBe(stopped);
});
