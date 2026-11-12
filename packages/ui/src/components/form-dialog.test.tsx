// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { FormDialog, ConfirmDialog } from './index.js';
import { Select } from '../pinharness/ui/select.js';

afterEach(cleanup);
function Harness() {
  const [open, setOpen] = useState(false);
  const [child, setChild] = useState(false);
  const [value, setValue] = useState('');
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setOpen(true)}>开启</button>
      <button>外部</button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="父对话框"
        onOpenAutoFocus={() => undefined}
      >
        <input aria-label="首项" />
        <button onClick={() => setCount(count + 1)}>更新{count}</button>
        <button onClick={() => setChild(true)}>子对话框</button>
        <input
          aria-label="消费Escape"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.preventDefault();
          }}
        />
        <Select
          value={value}
          onValueChange={setValue}
          options={[{ value: 'a', label: '选项A' }]}
          ariaLabel="选择项"
        />
        <FormDialog open={child} onOpenChange={setChild} title="子层">
          <input aria-label="子输入" />
        </FormDialog>
        <button>末项</button>
      </FormDialog>
    </>
  );
}
async function open() {
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: '开启' });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog', { name: '父对话框' });
  return trigger;
}
it('Escape关闭并恢复opener；closed挂载不抢焦点', async () => {
  const trigger = await open();
  fireEvent.keyDown(screen.getByLabelText('首项'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  screen.getByRole('button', { name: '外部' }).focus();
  expect(screen.getByRole('button', { name: '外部' })).toHaveFocus();
});
it('Tab首尾圈定，内联回调重渲染不重置焦点，子preventDefault保留父层', async () => {
  await open();
  const dialog = screen.getByRole('dialog');
  const last = screen.getByRole('button', { name: '末项' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(within(dialog).getByRole('button', { name: '关闭' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  const update = screen.getByRole('button', { name: '更新0' });
  update.focus();
  fireEvent.click(update);
  expect(screen.getByRole('button', { name: '更新1' })).toHaveFocus();
  const input = screen.getByLabelText('消费Escape');
  input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('嵌套只关闭最上层并恢复父层触发器，背景被隐藏', async () => {
  await open();
  const trigger = screen.getByRole('button', { name: '子对话框' });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog', { name: '子层' });
  expect(screen.queryByRole('dialog', { name: '父对话框' })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('子输入'), { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '子层' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('dialog', { name: '父对话框' })).toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});
it('Radix Select portal先消费Escape，第二次才关闭父层', async () => {
  await open();
  const select = screen.getByRole('combobox', { name: '选择项' });
  select.focus();
  fireEvent.keyDown(select, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  expect(listbox.style.zIndex).toBe('var(--ah-z-modal-popover, 1100)');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await waitFor(() => expect(select).toHaveFocus());
  fireEvent.keyDown(select, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('pending确认不可Escape或X关闭，backdrop也不触发放弃', async () => {
  const change = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={change}
      title="处理中"
      description="等待"
      pending
      onConfirm={() => undefined}
    />,
  );
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.pointerDown(document.body);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
  expect(change).not.toHaveBeenCalled();
});
it('autofocus可取消，unmount恢复且不覆盖新页面明确焦点', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const close = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
  const view = render(
    <FormDialog
      open
      onOpenChange={() => undefined}
      title="自动聚焦"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={close}
    >
      <input />
    </FormDialog>,
  );
  expect(opener).toHaveFocus();
  view.unmount();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  opener.remove();
});
it('卸载恢复原触发器，但后续路由已聚焦时不抢回', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const view = render(
    <FormDialog open onOpenChange={() => undefined} title="卸载">
      <input aria-label="内容" />
    </FormDialog>,
  );
  view.unmount();
  await waitFor(() => expect(opener).toHaveFocus());
  const view2 = render(
    <FormDialog open onOpenChange={() => undefined} title="再次卸载">
      <input />
    </FormDialog>,
  );
  view2.unmount();
  const newer = document.createElement('button');
  document.body.append(newer);
  newer.focus();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(newer).toHaveFocus();
  newer.remove();
  opener.remove();
});
it('同时挂载的独立弹窗只由顶层接受Escape', async () => {
  const first = vi.fn();
  const second = vi.fn();
  render(
    <>
      <FormDialog open onOpenChange={first} title="同开一">
        <input />
      </FormDialog>
      <FormDialog open onOpenChange={second} title="同开二">
        <input />
      </FormDialog>
    </>,
  );
  expect(screen.getByRole('dialog', { name: '同开二' })).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(second).toHaveBeenCalledWith(false));
  expect(first).not.toHaveBeenCalled();
});
it('关闭后立即重开时旧卸载回调不操作新实例焦点', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const close = vi.fn();
  const dialog = (open: boolean) => (
    <FormDialog
      open={open}
      onOpenChange={() => undefined}
      title="快速重开"
      onCloseAutoFocus={close}
    >
      <input aria-label="新实例输入" aria-invalid="true" />
    </FormDialog>
  );
  const view = render(dialog(true));
  view.rerender(dialog(false));
  view.rerender(dialog(true));
  const field = screen.getByLabelText('新实例输入');
  await waitFor(() => expect(field).toHaveFocus());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(field).toHaveFocus();
  view.unmount();
  opener.remove();
});
