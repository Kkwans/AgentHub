// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentConnectionCheck, parseConnectionReport } from './AgentConnectionCheck';
import { api, type AgentRecord, type ExecutionTargetRecord } from '../../../lib/api';
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<object>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});
let sequence = 0;
function fixture(kind = 'LOCAL_HOST') {
  const id = `check-${++sequence}`;
  const agent = {
    id,
    targetId: `target-${id}`,
    enabled: true,
    adapterKind: 'ACP_STDIO',
  } as AgentRecord;
  const target = { id: agent.targetId, kind } as ExecutionTargetRecord;
  const project = {
    id: 'project',
    name: '已登记项目',
    status: 'ACTIVE',
    targetId: agent.targetId,
    realRootPath: '/registered/root',
  };
  vi.mocked(api.get).mockResolvedValue([
    project,
    { ...project, id: 'foreign', name: '其他环境', targetId: 'foreign' },
  ]);
  const readSaved = vi.fn(async () => undefined);
  const props = { agent, target, disabled: false, readSaved };
  const scope = {
    agentId: id,
    targetId: agent.targetId,
    projectId: project.id,
    cwd: project.realRootPath,
  };
  const report = {
    ...scope,
    smokeSession: false,
    status: 'READY',
    checkedAt: '2026-11-14T06:00:00Z',
    checks: [
      { id: 'process', status: 'PASS' },
      { id: 'initialize', status: 'PASS' },
      { id: 'session', status: 'SKIP' },
    ],
  };
  return { props, scope, report };
}
async function choose() {
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/projects'));
  fireEvent.click(screen.getByRole('combobox', { name: '检查项目' }));
  fireEvent.click(await screen.findByRole('option', { name: '已登记项目' }));
}
it('只展示同环境已登记项目，显式一次POST，无cwd/smoke输入，完成后允许显式准备新检查', async () => {
  const f = fixture();
  vi.mocked(api.post).mockResolvedValue({ ...f.report, repair: { commands: ['SECRET'] } });
  render(<AgentConnectionCheck {...f.props} />);
  expect(api.post).not.toHaveBeenCalled();
  await choose();
  expect(screen.queryByText('其他环境')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  expect(await screen.findByText('连接检查通过')).toBeVisible();
  expect(api.post).toHaveBeenCalledExactlyOnceWith(`/agents/${f.scope.agentId}/connection-check`, {
    projectId: 'project',
    expectedTargetId: f.scope.targetId,
  });
  expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '准备新的检查' }));
  expect(screen.getByRole('button', { name: '检查连接' })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('断网unknown只读核对不解除写锁，remount保持unknown', async () => {
  const f = fixture();
  vi.mocked(api.post).mockRejectedValue(new Error('secret network'));
  const view = render(<AgentConnectionCheck {...f.props} />);
  await choose();
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  await screen.findByText(/检查结果待核对/);
  fireEvent.click(screen.getByRole('button', { name: '读取已保存状态' }));
  await waitFor(() => expect(f.props.readSaved).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: '检查连接' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '准备新的检查' })).not.toBeInTheDocument();
  view.unmount();
  render(<AgentConnectionCheck {...f.props} />);
  expect(screen.getByText(/检查结果待核对/)).toBeVisible();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('未返回POST离开后晚结果不把remount的unknown改成成功', async () => {
  const f = fixture();
  let finish!: (v: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }) as never,
  );
  const view = render(<AgentConnectionCheck {...f.props} />);
  await choose();
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  view.unmount();
  render(<AgentConnectionCheck {...f.props} />);
  await act(async () => finish(f.report));
  expect(screen.getByText(/检查结果待核对/)).toBeVisible();
  expect(screen.queryByText('连接检查通过')).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it.each(['DOCKER_CONTAINER', 'REMOTE_NODE'])('%s不读取项目、不启动检查', async (kind) => {
  const f = fixture(kind);
  render(<AgentConnectionCheck {...f.props} />);
  expect(screen.getByText(/容器和远程检查暂不在此开放/)).toBeVisible();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it('同component目标依赖变化后丢弃旧项目GET', async () => {
  const f = fixture();
  let finish!: (v: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }) as never,
  );
  const view = render(<AgentConnectionCheck {...f.props} />);
  view.rerender(
    <AgentConnectionCheck {...f.props} target={{ ...f.props.target, kind: 'REMOTE_NODE' }} />,
  );
  await act(async () =>
    finish([
      {
        id: 'old',
        name: '过期项目',
        targetId: f.scope.targetId,
        status: 'ACTIVE',
        realRootPath: '/old',
      },
    ]),
  );
  expect(screen.queryByText('过期项目')).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
it('报告只保留白名单，拒绝错误身份、smoke、未知状态与会话已创建', () => {
  const f = fixture();
  expect(
    parseConnectionReport(
      {
        ...f.report,
        details: 'secret',
        checks: f.report.checks.map((check) => ({ ...check, message: 'secret' })),
      },
      f.scope,
    ),
  ).not.toHaveProperty('details');
  for (const patch of [
    { agentId: 'other' },
    { targetId: 'other' },
    { cwd: '/other' },
    { smokeSession: true },
    { status: 'INVENTED' },
    { checks: [] },
    {
      checks: [
        { id: 'process', status: 'PASS' },
        { id: 'initialize', status: 'FAIL' },
        { id: 'session', status: 'SKIP' },
      ],
    },
    { checks: [{ id: 'session', status: 'PASS' }] },
  ])
    expect(() => parseConnectionReport({ ...f.report, ...patch }, f.scope)).toThrow();
});
it('65秒超时明确unknown，已保存状态不是解锁或重投凭据', async () => {
  const f = fixture();
  vi.mocked(api.post).mockImplementation(() => new Promise(() => undefined));
  render(<AgentConnectionCheck {...f.props} />);
  await choose();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(65_001);
  });
  expect(screen.getByText(/检查结果待核对/)).toBeVisible();
  expect(screen.getByRole('button', { name: '检查连接' })).toBeDisabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('本次结果在表单前，技术范围默认收起且展开不触发新检查', async () => {
  const f = fixture();
  vi.mocked(api.post).mockResolvedValue(f.report);
  render(<AgentConnectionCheck {...f.props} />);
  await choose();
  const preview = screen.getByText('查看检查目录').closest('details')!;
  expect(preview).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('查看检查目录'));
  expect(screen.getByText(f.scope.cwd)).toBeVisible();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  const status = await screen.findByText('连接检查通过');
  expect(screen.getByRole('group', { name: '本次连接检查结果' })).toBeVisible();
  const select = screen.getByRole('combobox', { name: '检查项目' });
  expect(status.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const summary = screen.getByText('检查范围与时间');
  const details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByText(f.scope.cwd)).not.toBeVisible();
  expect(screen.getByText(f.report.checkedAt)).not.toBeVisible();
  expect(screen.getByText(/不是项目任务可运行的保证/)).toBeVisible();
  fireEvent.click(summary);
  expect(screen.getByText(f.scope.cwd)).toBeVisible();
  expect(screen.getByText(f.scope.agentId)).toBeVisible();
  expect(screen.getByText(f.scope.targetId)).toBeVisible();
  expect(screen.getByText(f.scope.projectId)).toBeVisible();
  expect(screen.getByText(f.report.checkedAt)).toBeVisible();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('unknown 状态和不重投警告不随技术详情折叠，读回不改变原范围', async () => {
  const f = fixture();
  vi.mocked(api.post).mockRejectedValue(new Error('private'));
  render(<AgentConnectionCheck {...f.props} />);
  await choose();
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  const status = await screen.findByText(/检查结果待核对/);
  expect(status).toBeVisible();
  expect(
    status.compareDocumentPosition(screen.getByRole('combobox', { name: '检查项目' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(screen.getByText('检查范围与时间'));
  expect(screen.getByText(f.scope.targetId)).toBeVisible();
  fireEvent.click(screen.getByText('检查范围与时间'));
  expect(status).toBeVisible();
  expect(screen.getByText(/已保存状态不是原请求的成功凭据/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '读取已保存状态' }));
  await waitFor(() => expect(f.props.readSaved).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: '检查连接' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '准备新的检查' })).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
});
