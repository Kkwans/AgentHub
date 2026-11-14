// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Select } from './select.js';
import { FormDialog } from '../../components/index.js';

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

async function closeModalSelection() {
  vi.useFakeTimers();
  render(
    <FormDialog open onOpenChange={() => undefined} title="绑定 Prompt">
      <input aria-label="绑定名称" />
      <span data-testid="transient-status">读取状态</span>
      <Select
        searchable
        ariaLabel="目标类型"
        options={[{ value: 'project', label: 'Project' }]}
        onValueChange={() => undefined}
      />
    </FormDialog>,
  );
  const trigger = screen.getByRole('combobox', { name: '目标类型' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
  screen.getByRole('searchbox', { name: '搜索选项' }).focus();
  expect(screen.getByRole('searchbox', { name: '搜索选项' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  // Model the parent form removing a transient status while the Select closes.
  // The real parent FocusScope MutationObserver, not a test focus call, owns fallback.
  screen.getByTestId('transient-status').remove();
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: '绑定 Prompt' })).toHaveFocus();
  return { trigger };
}

it('父Modal中的Select关闭仍恢复trigger而不是父层自动fallback', async () => {
  const { trigger } = await closeModalSelection();
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
  expect(screen.getByRole('dialog', { name: '绑定 Prompt' })).toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('父Modal内新的真实输入焦点不是可豁免的根fallback', async () => {
  await closeModalSelection();
  const input = screen.getByRole('textbox', { name: '绑定名称' });
  input.focus();
  expect(input).toHaveFocus();
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
  expect(input).toHaveFocus();
});

it('新Modal根不属于旧Select的父层fallback', async () => {
  await closeModalSelection();
  render(
    <FormDialog open onOpenChange={() => undefined} title="新对话框">
      <input aria-label="下一项" />
    </FormDialog>,
  );
  const newDialog = screen.getByRole('dialog', { name: '新对话框' });
  newDialog.focus();
  expect(newDialog).toHaveFocus();
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
  expect(newDialog).toHaveFocus();
});
