// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BindingOperationResults } from './BindingOperationResults';
import type { BindingOperation } from '../lib/binding-operation-owner';
afterEach(cleanup);
function record(id: number, phase: BindingOperation['phase']): BindingOperation {
  return {
    id,
    auth: 'local_trusted',
    authEpoch: 1,
    promptName: `模板${id}`,
    targetName: `目标${id}`,
    phase,
    payload: {
      promptId: `prompt-${id}`,
      targetId: `target-${id}`,
      targetType: 'AGENT',
      slot: 'SYSTEM',
      selectorType: 'VERSION',
      versionId: 'v1',
      priority: 0,
    },
    message:
      phase === 'pending'
        ? '关闭不会取消请求。'
        : phase === 'unknown'
          ? '结果未确认，勿重复创建。'
          : phase === 'rejected'
            ? '未保存：目标已移除。'
            : '已保存原绑定。',
    ...(phase === 'saved' ? { bindingId: `binding-${id}` } : {}),
  };
}
it('active名字和风险常显，技术ID默认折叠且原生summary可聚焦展开', () => {
  const dismiss = vi.fn();
  render(
    <BindingOperationResults
      operations={[record(1, 'unknown')]}
      dismiss={dismiss}
      onEmptyFocus={() => undefined}
    />,
  );
  const result = screen.getByRole('alert', { name: '绑定操作结果' });
  expect(within(result).getByText('结果未确认，勿重复创建。')).toBeVisible();
  expect(within(result).getByText(/模板1 → Agent · 目标1/)).toBeVisible();
  expect(within(result).getByText('prompt-1')).not.toBeVisible();
  const summary = result.querySelector('summary')!;
  summary.focus();
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(summary.parentElement).toHaveAttribute('open');
  expect(within(result).getByText('prompt-1')).toBeVisible();
  expect(within(result).queryByRole('button', { name: '关闭此结果提示' })).not.toBeInTheDocument();
  expect(dismiss).not.toHaveBeenCalled();
});
it('pending变终态不重挂summary，不丢焦点或已展开核对状态', () => {
  const props = { dismiss: vi.fn(), onEmptyFocus: vi.fn() };
  const view = render(<BindingOperationResults {...props} operations={[record(1, 'pending')]} />);
  const summary = view.container.querySelector('summary')!;
  fireEvent.click(summary);
  summary.focus();
  view.rerender(<BindingOperationResults {...props} operations={[record(1, 'saved')]} />);
  expect(view.container.querySelector('summary')).toBe(summary);
  expect(summary).toHaveFocus();
  expect(summary.parentElement).toHaveAttribute('open');
  expect(screen.getByText('binding-1')).toBeVisible();
  expect(screen.getByRole('button', { name: '关闭此结果提示' })).toBeVisible();
});
it('关闭终态移焦至下一条summary且保留unknown，最后关闭交还页面焦点', () => {
  const emptyFocus = vi.fn();
  function Harness() {
    const [operations, setOperations] = useState([record(1, 'saved'), record(2, 'unknown')]);
    return (
      <BindingOperationResults
        operations={operations}
        dismiss={(id) => setOperations((items) => items.filter((item) => item.id !== id))}
        onEmptyFocus={emptyFocus}
      />
    );
  }
  const view = render(<Harness />);
  const activeSummary = screen
    .getByRole('alert', { name: '绑定操作结果' })
    .querySelector('summary')!;
  const close = screen.getByRole('button', { name: '关闭此结果提示' });
  close.focus();
  fireEvent.click(close);
  expect(activeSummary).toHaveFocus();
  expect(screen.getByRole('alert', { name: '绑定操作结果' })).toContainElement(activeSummary);
  expect(screen.getByText('结果未确认，勿重复创建。')).toBeVisible();
  expect(emptyFocus).not.toHaveBeenCalled();
  view.unmount();
  function Last() {
    const [operations, setOperations] = useState([record(3, 'rejected')]);
    return (
      <BindingOperationResults
        operations={operations}
        dismiss={() => setOperations([])}
        onEmptyFocus={emptyFocus}
      />
    );
  }
  render(<Last />);
  fireEvent.click(screen.getByRole('button', { name: '关闭此结果提示' }));
  expect(emptyFocus).toHaveBeenCalledTimes(1);
});
