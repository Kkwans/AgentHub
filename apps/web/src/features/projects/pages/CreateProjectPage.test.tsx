// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateProjectPage } from './CreateProjectPage';
import { ApiError } from '../../../lib/api-error';
import { authSession } from '../../../lib/auth-api';
import type * as ApiModule from '../../../lib/api';

const { get, post } = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string, data?: unknown) => Promise<unknown>>(),
}));
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { get, post },
}));
vi.mock('./ProjectsPage', () => ({ ProjectsPage: () => <div>项目列表背景</div> }));

const firstRoot = {
  rootId: 'root-a',
  label: '工作区',
  path: '/allowed',
  targetId: 'a',
  source: 'CONFIGURED',
};
const secondRoot = {
  rootId: 'root-b',
  label: '另一工作区',
  path: '/other',
  targetId: 'b',
  source: 'CONFIGURED',
};
const targets = [
  { id: 'a', name: '环境 A', os: 'linux', arch: 'arm64' },
  { id: 'b', name: '环境 B', os: 'linux', arch: 'arm64' },
];
const candidate = {
  name: 'repo-a',
  rootPath: '/allowed/repo-a',
  relativePath: 'repo-a',
  readable: true,
  git: true,
};
const createdId = '99999999-9999-4999-8999-999999999999';
function receipt(input: unknown = { targetId: 'a', rootPath: '/allowed/repo-a', name: 'repo-a' }) {
  return { id: createdId, ...(input as Record<string, unknown>) };
}
const clients: QueryClient[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function defaultGet(path: string): Promise<unknown> {
  if (path === '/execution-targets') return targets;
  const other = path.includes('/execution-targets/b/');
  const root = other ? secondRoot : firstRoot;
  if (path.endsWith('/filesystem/roots')) return [root];
  if (path.includes('/project-candidates?')) return other ? [] : [candidate];
  if (path.includes('/filesystem/directories?')) {
    const directory = new URLSearchParams(path.split('?')[1]).get('path');
    return {
      root,
      path: directory,
      entries:
        directory === '/allowed'
          ? [
              { name: 'nested', path: '/allowed/nested', type: 'DIRECTORY', accessible: true },
              { name: 'escape', path: '/allowed/escape', type: 'SYMLINK', accessible: false },
              { name: 'README.md', path: '/allowed/README.md', type: 'FILE', accessible: true },
            ]
          : [],
    };
  }
  throw new Error(`Unexpected GET ${path}`);
}
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/new']}>
        <Location />
        <Routes>
          <Route path="/projects/new" element={<CreateProjectPage />} />
          <Route path="/projects" element={<h1>返回项目列表</h1>} />
          <Route path="/projects/:id/overview" element={<h1>项目详情</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function chooseTargetB() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: '运行环境' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '环境 B · linux/arm64' }));
}
async function chooseCandidate() {
  fireEvent.click(await screen.findByRole('button', { name: /repo-a.*选择/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: '预检并创建' })).toBeEnabled());
}
beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation(defaultGet);
  post.mockImplementation(async (path, data) =>
    path === '/projects/preflight' ? { status: 'READY', checks: [] } : receipt(data),
  );
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('创建项目的授权目录选择', () => {
  it('选择发现的嵌套仓库，以准确路径预检并创建，而不是授权父目录', async () => {
    mount();
    await chooseCandidate();
    expect(post).toHaveBeenCalledWith('/projects/preflight', {
      targetId: 'a',
      rootPath: '/allowed/repo-a',
    });
    fireEvent.click(screen.getByRole('button', { name: '预检并创建' }));
    await screen.findByText('项目详情');
    expect(post).toHaveBeenCalledWith('/projects', {
      name: 'repo-a',
      targetId: 'a',
      rootPath: '/allowed/repo-a',
      kind: 'STANDARD',
    });
  });

  it('可以逐级浏览和返回，只允许选择服务端允许的目录', async () => {
    mount();
    expect(await screen.findByRole('button', { name: /不可访问目录 escape/ })).toBeDisabled();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '进入目录 nested' }));
    await screen.findByText('当前目录没有可浏览的子目录，仍可选择当前目录。');
    fireEvent.click(screen.getByRole('button', { name: '选择当前目录' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/projects/preflight', {
        targetId: 'a',
        rootPath: '/allowed/nested',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }));
    await screen.findByRole('button', { name: '进入目录 nested' });
    expect(screen.getByRole('button', { name: '返回上一级' })).toBeDisabled();
  });

  it('切换运行环境后迟到的目录与候选响应不污染新环境', async () => {
    const oldRoots = deferred<unknown>();
    get.mockImplementation((path) =>
      path === '/execution-targets/a/filesystem/roots' ? oldRoots.promise : defaultGet(path),
    );
    mount();
    await screen.findByText('正在读取授权目录');
    await chooseTargetB();
    await screen.findByText('此授权目录尚未发现项目。');
    await act(async () => oldRoots.resolve([firstRoot]));
    expect(screen.queryByRole('button', { name: /repo-a.*选择/ })).not.toBeInTheDocument();
    expect(
      get.mock.calls.some(
        ([path]) => path.includes('/execution-targets/b/') && path.includes('root-a'),
      ),
    ).toBe(false);
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
  });

  it('切换环境清除选择，迟到的预检成功不能放行旧目录', async () => {
    const oldPreflight = deferred<unknown>();
    post.mockImplementation(() => oldPreflight.promise);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /repo-a.*选择/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    await chooseTargetB();
    await act(async () => oldPreflight.resolve({ status: 'READY', checks: [] }));
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
    expect(screen.getByText(/已选择的项目目录/)).toHaveTextContent('尚未选择');
  });

  it('显示目录读取失败并可重试，不把失败显示为空目录', async () => {
    let fail = true;
    get.mockImplementation((path) =>
      path.includes('/filesystem/directories?') && fail
        ? Promise.reject(new Error('目录服务离线'))
        : defaultGet(path),
    );
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法读取子目录');
    expect(
      screen.queryByText('当前目录没有可浏览的子目录，仍可选择当前目录。'),
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
    await screen.findByRole('button', { name: '进入目录 nested' });
  });

  it('授权根目录读取失败和无授权根目录分别说明', async () => {
    let fail = true;
    get.mockImplementation((path) =>
      path.endsWith('/filesystem/roots')
        ? fail
          ? Promise.reject(new Error('没有连接'))
          : Promise.resolve([])
        : defaultGet(path),
    );
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法读取授权目录');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
    await screen.findByText('当前运行环境没有可访问的授权目录，请先检查工作区配置。');
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
  });

  it('预检拒绝或失败时不能提交', async () => {
    post.mockResolvedValue({
      status: 'BROKEN',
      checks: [{ id: 'path', status: 'FAIL', message: '目录不可访问' }],
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /repo-a.*选择/ }));
    await screen.findByText('目录不可访问');
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
  });

  it('快速重复提交只发送一次，取消后迟到成功不能夺回导航', async () => {
    const creation = deferred<unknown>();
    post.mockImplementation(async (path) =>
      path === '/projects' ? creation.promise : { status: 'READY', checks: [] },
    );
    mount();
    await chooseCandidate();
    const button = screen.getByRole('button', { name: '预检并创建' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(post.mock.calls.filter(([path]) => path === '/projects')).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await screen.findByText('返回项目列表');
    await act(async () => creation.resolve(receipt()));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects');
    expect(screen.queryByText('项目详情')).not.toBeInTheDocument();
  });

  it('网络失败时保留未知结果并阻止盲目重提', async () => {
    post.mockImplementation(async (path) => {
      if (path === '/projects') throw new Error('Network error');
      return { status: 'READY', checks: [] };
    });
    mount();
    await chooseCandidate();
    fireEvent.click(screen.getByRole('button', { name: '预检并创建' }));
    await screen.findByText('创建结果尚未确认');
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
    expect(post.mock.calls.filter(([path]) => path === '/projects')).toHaveLength(1);
  });

  it('明确参数拒绝后允许修正并重试', async () => {
    let fail = true;
    post.mockImplementation(async (path, data) => {
      if (path === '/projects') {
        if (fail) throw new ApiError('VALIDATION_FAILED', '名称不符合要求', 400);
        return receipt(data);
      }
      return { status: 'READY', checks: [] };
    });
    mount();
    await chooseCandidate();
    fireEvent.click(screen.getByRole('button', { name: '预检并创建' }));
    await screen.findByText('名称不符合要求');
    fail = false;
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), {
      target: { value: 'new name' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预检并创建' }));
    await screen.findByText('项目详情');
  });
  it('旧环境迟到的候选不会出现在新环境，也不会选择旧路径', async () => {
    const oldCandidates = deferred<unknown>();
    get.mockImplementation((path) =>
      path.includes('/execution-targets/a/project-candidates?')
        ? oldCandidates.promise
        : defaultGet(path),
    );
    mount();
    await screen.findByText('正在发现项目');
    await chooseTargetB();
    await screen.findByText('此授权目录尚未发现项目。');
    await act(async () => oldCandidates.resolve([candidate]));
    expect(screen.queryByRole('button', { name: /repo-a.*选择/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
  });

  it('项目发现错误不阻断授权目录浏览', async () => {
    get.mockImplementation((path) =>
      path.includes('/project-candidates?')
        ? Promise.reject(new Error('扫描失败'))
        : defaultGet(path),
    );
    mount();
    await screen.findByText('项目发现失败，仍可浏览目录');
    fireEvent.click(await screen.findByRole('button', { name: '进入目录 nested' }));
    await screen.findByText('当前目录没有可浏览的子目录，仍可选择当前目录。');
    fireEvent.click(screen.getByRole('button', { name: '选择当前目录' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '预检并创建' })).toBeEnabled());
  });

  it('运行环境加载失败可重试，空环境有明确提示', async () => {
    let fail = true;
    get.mockImplementation((path) =>
      path === '/execution-targets'
        ? fail
          ? Promise.reject(new Error('连接失败'))
          : Promise.resolve([])
        : defaultGet(path),
    );
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法读取运行环境');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
    await screen.findByText('尚无可用运行环境，请先在 Agent 页面接入运行环境。');
  });

  it('预检网络失败后允许读取重试，不允许创建', async () => {
    let fail = true;
    post.mockImplementation(async () => {
      if (fail) throw new Error('预检连接失败');
      return { status: 'READY', checks: [] };
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /repo-a.*选择/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('目录预检失败');
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '预检并创建' })).toBeEnabled());
  });
  it('更换授权根目录时清除旧选择与浏览层级', async () => {
    const alternate = {
      ...firstRoot,
      rootId: 'root-other',
      path: '/allowed-other',
      label: '备选工作区',
    };
    get.mockImplementation((path) => {
      if (path.endsWith('/filesystem/roots')) return Promise.resolve([firstRoot, alternate]);
      if (path.includes('root=root-other'))
        return Promise.resolve(
          path.includes('/project-candidates?')
            ? []
            : { root: alternate, path: alternate.path, entries: [] },
        );
      return defaultGet(path);
    });
    mount();
    await chooseCandidate();
    fireEvent.keyDown(screen.getByRole('combobox', { name: '授权根目录' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: '备选工作区 · /allowed-other' }));
    await screen.findByText('此授权目录尚未发现项目。');
    expect(screen.getByText(/已选择的项目目录/)).toHaveTextContent('尚未选择');
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '返回上一级' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '选择当前目录' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/projects/preflight', {
        targetId: 'a',
        rootPath: '/allowed-other',
      }),
    );
  });
  it.each([
    null,
    {},
    { id: 'bad' },
    { ...receipt(), targetId: 'wrong' },
    { ...receipt(), rootPath: '/wrong' },
  ])('损坏或目标不符的创建回执保持未知状态 %#', async (response) => {
    post.mockImplementation(async (path) =>
      path === '/projects' ? response : { status: 'READY', checks: [] },
    );
    mount();
    await chooseCandidate();
    fireEvent.click(screen.getByRole('button', { name: '预检并创建' }));
    await screen.findByText('创建结果尚未确认');
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/new');
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
  });

  it('任意 4xx 响应不能当成明确未创建', async () => {
    post.mockImplementation(async (path) => {
      if (path === '/projects') throw new ApiError('HTTP_ERROR', '代理返回异常', 400);
      return { status: 'READY', checks: [] };
    });
    mount();
    await chooseCandidate();
    fireEvent.click(screen.getByRole('button', { name: '预检并创建' }));
    await screen.findByText('创建结果尚未确认');
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
  });

  it('认证失效后迟到的创建成功不能导航或继续提交', async () => {
    const creation = deferred<unknown>();
    post.mockImplementation(async (path) =>
      path === '/projects' ? creation.promise : { status: 'READY', checks: [] },
    );
    mount();
    await chooseCandidate();
    fireEvent.click(screen.getByRole('button', { name: '预检并创建' }));
    await act(async () => authSession.notifyAuthorizationRequired());
    await screen.findByText('登录状态已失效');
    await act(async () => creation.resolve(receipt()));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/new');
    expect(screen.queryByText('项目详情')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预检并创建' })).toBeDisabled();
  });
});
