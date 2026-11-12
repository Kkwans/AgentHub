// @vitest-environment jsdom
import { observeElementOffset, observeElementRect, Virtualizer } from '@tanstack/react-virtual';
import { afterEach, expect, it, vi } from 'vitest';
import { observeTimelineOffset } from './observe-timeline-offset';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});
function fixture() {
  vi.useFakeTimers();
  const element = document.createElement('div');
  document.body.append(element);
  const instance = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 20,
    getScrollElement: () => element,
    estimateSize: () => 160,
    scrollToFn: () => undefined,
    observeElementRect,
    observeElementOffset,
    useScrollendEvent: false,
    isScrollingResetDelay: 150,
  });
  instance.scrollElement = element;
  instance.targetWindow = window;
  const scroll = (offset: number) => {
    element.scrollTop = offset;
    element.dispatchEvent(new Event('scroll'));
  };
  return { instance, element, scroll };
}
it('活跃订阅保留官方scroll与150ms scroll-end通知', () => {
  const { instance, scroll } = fixture();
  const callback = vi.fn();
  const dispose = observeTimelineOffset(instance, callback);
  scroll(42);
  expect(callback).toHaveBeenLastCalledWith(42, true);
  vi.advanceTimersByTime(150);
  expect(callback).toHaveBeenLastCalledWith(42, false);
  expect(callback).toHaveBeenCalledTimes(2);
  dispose?.();
});
it('卸载时已排队的官方debounce及卸载后scroll都不能通知旧订阅', () => {
  const { instance, element, scroll } = fixture();
  const callback = vi.fn();
  const dispose = observeTimelineOffset(instance, callback);
  scroll(42);
  expect(callback).toHaveBeenCalledTimes(1);
  dispose?.();
  element.remove();
  scroll(84);
  vi.advanceTimersByTime(150);
  expect(callback).toHaveBeenCalledTimes(1);
});
it('同元素重新订阅时旧debounce不得冒充新订阅通知', () => {
  const { instance, scroll } = fixture();
  const old = vi.fn();
  const dispose = observeTimelineOffset(instance, old);
  scroll(42);
  dispose?.();
  const current = vi.fn();
  const unsubscribe = observeTimelineOffset(instance, current);
  scroll(84);
  vi.advanceTimersByTime(150);
  expect(old).toHaveBeenCalledTimes(1);
  expect(current.mock.calls).toEqual([
    [84, true],
    [84, false],
  ]);
  unsubscribe?.();
});
