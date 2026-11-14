// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileDrawerPanel } from './pinharness/mobile-drawer.js';

let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let frames: Map<number, FrameRequestCallback>;
let serial = 0;
beforeEach(() => {
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // Lifecycle simulation only: jsdom has no native top layer or inert behavior.
  showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const content = (open: boolean, onClose: () => void) => (
  <MobileDrawerPanel open={open} onClose={onClose} ariaLabel="测试导航">
    <button>第一项</button>
    <button>末项</button>
  </MobileDrawerPanel>
);
it('enters the native modal top layer and requests Escape cancellation only once', () => {
  const onClose = vi.fn();
  render(content(true, onClose));
  expect(showModal).toHaveBeenCalledTimes(1);
  const event = new Event('cancel', { cancelable: true });
  fireEvent(screen.getByRole('dialog'), event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  fireEvent.popState(window);
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('restores the opener and cancels deferred focus after a rapid close', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const view = render(content(true, vi.fn()));
  const first = screen.getByRole('button', { name: '第一项' });
  const focus = vi.spyOn(first, 'focus');
  view.rerender(content(false, vi.fn()));
  act(() => {
    for (const callback of frames.values()) callback(0);
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(focus).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
it('handles native backdrop coordinates but does not close on dialog content clicks', () => {
  const onClose = vi.fn();
  render(content(true, onClose));
  const dialog = screen.getByRole('dialog');
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 312,
    bottom: 844,
    width: 312,
    height: 844,
    toJSON: () => ({}),
  });
  fireEvent.click(screen.getByRole('button', { name: '第一项' }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(dialog, { clientX: 360, clientY: 400 });
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('removes drawer history marker for actions and permits a fresh open after closing', () => {
  const onClose = vi.fn();
  const view = render(
    <MobileDrawerPanel open onClose={onClose} ariaLabel="测试导航">
      {(done) => <button onClick={done}>进入项目</button>}
    </MobileDrawerPanel>,
  );
  expect(window.history.state.mobileDrawer).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '进入项目' }));
  expect(window.history.state.mobileDrawer).toBeUndefined();
  expect(onClose).toHaveBeenCalledTimes(1);
  view.rerender(content(false, onClose));
  view.rerender(content(true, onClose));
  expect(showModal).toHaveBeenCalledTimes(2);
  fireEvent.popState(window);
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('does not replace a newly focused route destination during cleanup', () => {
  const view = render(content(true, vi.fn()));
  const target = document.createElement('button');
  document.body.append(target);
  target.focus();
  view.rerender(content(false, vi.fn()));
  expect(document.activeElement).toBe(target);
  target.remove();
});
it('clears only its own marker on controlled close without a drawer action', () => {
  const view = render(content(true, vi.fn()));
  view.rerender(content(false, vi.fn()));
  expect(window.history.state.mobileDrawer).toBeUndefined();
});

it('does not erase a different route history marker on cleanup', () => {
  const view = render(content(true, vi.fn()));
  window.history.replaceState({ mobileDrawer: 'another-owner', route: 'new' }, '');
  view.rerender(content(false, vi.fn()));
  expect(window.history.state).toEqual({ mobileDrawer: 'another-owner', route: 'new' });
});

function exposeRects(root: HTMLElement) {
  for (const node of root.querySelectorAll<HTMLElement>('*'))
    Object.defineProperty(node, 'getClientRects', {
      configurable: true,
      value: () => [{ width: 44, height: 44 }],
    });
}
it('wraps reverse and forward Tab only at visible focusable boundaries', () => {
  render(content(true, vi.fn()));
  const dialog = screen.getByRole('dialog');
  exposeRects(dialog);
  const first = screen.getByRole('button', { name: '第一项' });
  const last = screen.getByRole('button', { name: '末项' });
  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  const interior = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  fireEvent(first, interior);
  expect(interior.defaultPrevented).toBe(false);
});
it('ignores disabled, hidden, inert, non-tab and layout-invisible endpoints', () => {
  render(
    <MobileDrawerPanel open onClose={() => {}} ariaLabel="测试导航">
      <button disabled>disabled first</button>
      <div hidden>
        <button>hidden first</button>
      </div>
      <button>有效首项</button>
      <button style={{ visibility: 'hidden' }}>invisible</button>
      <div inert>
        <button>inert last</button>
      </div>
      <button tabIndex={-1}>not tab</button>
      <button>有效末项</button>
      <button data-no-layout>no layout</button>
    </MobileDrawerPanel>,
  );
  const dialog = screen.getByRole('dialog');
  exposeRects(dialog);
  Object.defineProperty(dialog.querySelector('[data-no-layout]')!, 'getClientRects', {
    value: () => [],
  });
  const first = screen.getByRole('button', { name: '有效首项' }),
    last = screen.getByRole('button', { name: '有效末项' });
  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
});
it('keeps an empty focus set on the dialog and leaves Escape to native cancellation', () => {
  const onClose = vi.fn();
  render(
    <MobileDrawerPanel open onClose={onClose} ariaLabel="测试导航">
      <button disabled>不可用</button>
    </MobileDrawerPanel>,
  );
  const dialog = screen.getByRole('dialog');
  exposeRects(dialog);
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  fireEvent(dialog, tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(dialog);
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fireEvent(dialog, escape);
  expect(escape.defaultPrevented).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});
