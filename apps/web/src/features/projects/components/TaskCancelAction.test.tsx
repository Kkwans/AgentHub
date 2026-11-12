// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TaskCancelAction } from './TaskCancelAction';
import type { TaskRecord } from '../../../lib/api';

afterEach(cleanup);
function mount(status: TaskRecord['status'], sessionId: string | null = null) {
  const cancel = vi.fn();
  function Location() {
    return <output>{useLocation().pathname}</output>;
  }
  render(
    <MemoryRouter>
      <TaskCancelAction task={{ status, sessionId }} pending={false} onCancel={cancel} />
      <Location />
    </MemoryRouter>,
  );
  return cancel;
}
it('进行中仅提供精确工作区入口，不发送状态取消', () => {
  const cancel = mount('IN_PROGRESS', 'session-1');
  expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '前往工作区停止执行' }));
  expect(screen.getByRole('status')).toHaveTextContent('/workspace/session-1');
  expect(cancel).not.toHaveBeenCalled();
});
it('无Session的手工任务请求服务端核对后取消，不猜测工作区', () => {
  const cancel = mount('IN_PROGRESS');
  expect(screen.getByText(/仅当服务器确认没有未决 Run/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '前往工作区停止执行' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '核对并取消任务' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});
it.each(['BACKLOG', 'READY', 'BLOCKED'] as const)('%s保持原取消动作', (status) => {
  const cancel = mount(status);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});
it.each(['DONE', 'CANCELED'] as const)('%s不提供可执行取消', (status) => {
  mount(status);
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
});
