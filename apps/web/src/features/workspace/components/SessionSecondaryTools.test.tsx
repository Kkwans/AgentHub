// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormDialog } from '@agenthub/ui';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionSecondaryTools } from './SessionSecondaryTools';
beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('关闭和重新打开保留唯一动作树、草稿和未决状态，不重新挂载', () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Action() {
    const [value, setValue] = useState('');
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <input
        aria-label="未决草稿"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }
  render(
    <SessionSecondaryTools sessionId="a">
      <Action />
    </SessionSecondaryTools>,
  );
  const more = screen.getByRole('button', { name: '更多会话操作' });
  fireEvent.click(more);
  fireEvent.change(screen.getByLabelText('未决草稿'), { target: { value: '不可丢失' } });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(more).toHaveFocus();
  fireEvent.click(more);
  expect(screen.getAllByLabelText('未决草稿')).toHaveLength(1);
  expect(screen.getByLabelText('未决草稿')).toHaveValue('不可丢失');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});
it('外部点击收起并恢复更多焦点，session变化收起但不卸载动作树', () => {
  const unmounted = vi.fn();
  function Action() {
    useEffect(() => unmounted, []);
    return <button>动作</button>;
  }
  const view = render(
    <SessionSecondaryTools sessionId="a">
      <Action />
    </SessionSecondaryTools>,
  );
  const more = screen.getByRole('button', { name: '更多会话操作' });
  fireEvent.click(more);
  fireEvent.pointerDown(document.body);
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(more).toHaveFocus();
  fireEvent.click(more);
  view.rerender(
    <SessionSecondaryTools sessionId="b">
      <Action />
    </SessionSecondaryTools>,
  );
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(unmounted).not.toHaveBeenCalled();
});
it('Portal FormDialog持有关闭和恢复焦点，不能先隐藏原动作', async () => {
  function Action() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>编辑动作</button>
        <FormDialog open={open} onOpenChange={setOpen} title="编辑">
          <input aria-label="编辑草稿" />
        </FormDialog>
      </>
    );
  }
  render(
    <SessionSecondaryTools sessionId="a">
      <Action />
    </SessionSecondaryTools>,
  );
  const more = screen.getByRole('button', { name: '更多会话操作' });
  fireEvent.click(more);
  const action = screen.getByRole('button', { name: '编辑动作' });
  action.focus();
  fireEvent.click(action);
  fireEvent.pointerDown(document.body);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(screen.getByLabelText('编辑草稿'), { key: 'Escape' });
  expect(more).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(action).toHaveFocus());
});

it('桌面动作仍直达，缩到手机后保留打开状态；桌面外部交互不聚焦隐藏更多', () => {
  let mobile = false;
  vi.stubGlobal('matchMedia', () => ({ matches: mobile }));
  render(
    <SessionSecondaryTools sessionId="a">
      <button>编辑动作</button>
    </SessionSecondaryTools>,
  );
  const more = screen.getByRole('button', { name: '更多会话操作' });
  const action = screen.getByRole('button', { name: '编辑动作' });
  action.focus();
  fireEvent.click(action);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerDown(document.body);
  expect(action).toHaveFocus();
  mobile = true;
  expect(more).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(more).toHaveFocus();
});
