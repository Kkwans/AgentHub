// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Select } from './select.js';

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function closeSelection() {
  vi.useFakeTimers();
  const changed = vi.fn();
  const view = render(
    <>
      <Select
        ariaLabel="检查项目"
        options={[{ value: 'project', label: '项目一' }]}
        onValueChange={changed}
      />
      <details>
        <summary>查看检查目录</summary>
        <p>合成测试目录</p>
      </details>
    </>,
  );
  const trigger = screen.getByRole('combobox', { name: '检查项目' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const oldOption = screen.getByRole('option', { name: '项目一' });
  oldOption.focus();
  expect(oldOption).toHaveFocus();
  fireEvent.click(oldOption);
  expect(oldOption.isConnected).toBe(false);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(changed).toHaveBeenCalledExactlyOnceWith('project');
  return { trigger, changed, view };
}

it('普通关闭在延迟恢复完成后回到原选择器', () => {
  const { trigger, changed } = closeSelection();
  act(() => vi.runOnlyPendingTimers());
  expect(trigger).toHaveFocus();
  expect(changed).toHaveBeenCalledTimes(1);
});

it('假设检验：关闭后已获得外部焦点的新意图不应被迟到恢复覆盖', () => {
  const { trigger, changed } = closeSelection();
  const summary = screen.getByText('查看检查目录');
  // Explicitly model a later focus intent; the CI trace does not itself record this event.
  summary.focus();
  expect(summary).toHaveFocus();
  act(() => vi.runOnlyPendingTimers());
  expect(summary).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(changed).toHaveBeenCalledTimes(1);
});

it('关闭后document body无新意图时仍恢复原选择器', () => {
  const { trigger } = closeSelection();
  (document.activeElement as HTMLElement | null)?.blur();
  expect(document.body).toHaveFocus();
  act(() => vi.runOnlyPendingTimers());
  expect(trigger).toHaveFocus();
});

it('迟到关闭不抢新dialog中的输入焦点', () => {
  closeSelection();
  const dialog = render(
    <div role="dialog" aria-label="新操作">
      <input aria-label="新输入" />
    </div>,
  );
  const input = screen.getByRole('textbox', { name: '新输入' });
  input.focus();
  act(() => vi.runOnlyPendingTimers());
  expect(input).toHaveFocus();
  dialog.unmount();
});

it('旧关闭不能覆盖重复打开后的当前选项焦点', () => {
  const { trigger, changed } = closeSelection();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const option = screen.getByRole('option', { name: '项目一' });
  option.focus();
  act(() => vi.runOnlyPendingTimers());
  expect(option).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(option);
  act(() => vi.runOnlyPendingTimers());
  expect(trigger).toHaveFocus();
  expect(changed).toHaveBeenCalledTimes(1);
});

it('选择器所在页面卸载后不抢新页面输入焦点', () => {
  const { view } = closeSelection();
  view.unmount();
  render(<input aria-label="新页面输入" autoFocus />);
  const input = screen.getByRole('textbox', { name: '新页面输入' });
  expect(input).toHaveFocus();
  act(() => vi.runOnlyPendingTimers());
  expect(input).toHaveFocus();
});
