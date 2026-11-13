// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreeColumnSplit } from './three-column-split.js';
afterEach(cleanup);
it('controlled phone deep link must not emit default middle on initial mount', () => {
  const changed = vi.fn();
  render(
    <ThreeColumnSplit
      left={<div>sessions</div>}
      middle={<div>conversation</div>}
      right={<div>review</div>}
      leftCollapsed={false}
      rightCollapsed={true}
      onOpenLeft={vi.fn()}
      onOpenRight={vi.fn()}
      leftLabel="会话"
      rightLabel="检查器"
      leftRatioKey="l"
      rightRatioKey="r"
      layoutMode="single"
      compactPanel="right"
      onCompactPanelChange={changed}
    />,
  );
  expect(changed).not.toHaveBeenCalled();
});

it('controlled selection survives medium to phone without emitting a reset', () => {
  const changed = vi.fn();
  const props = {
    left: <div>sessions</div>,
    middle: <div>conversation</div>,
    right: <div>review</div>,
    leftCollapsed: false,
    rightCollapsed: true,
    onOpenLeft: vi.fn(),
    onOpenRight: vi.fn(),
    leftLabel: '会话',
    leftRatioKey: 'l',
    rightRatioKey: 'r',
    compactPanel: 'right' as const,
    onCompactPanelChange: changed,
  };
  const view = render(<ThreeColumnSplit {...props} layoutMode="medium" />);
  view.rerender(<ThreeColumnSplit {...props} layoutMode="single" />);
  expect(changed).not.toHaveBeenCalled();
});
it('uncontrolled default changes retain their initialization behavior', () => {
  const changed = vi.fn();
  const props = {
    left: <div>sessions</div>,
    middle: <div>conversation</div>,
    right: <div>review</div>,
    leftCollapsed: false,
    rightCollapsed: true,
    onOpenLeft: vi.fn(),
    onOpenRight: vi.fn(),
    leftLabel: '会话',
    leftRatioKey: 'l',
    rightRatioKey: 'r',
    onCompactPanelChange: changed,
  };
  const view = render(
    <ThreeColumnSplit {...props} layoutMode="single" defaultCompactPanel="middle" />,
  );
  expect(changed).toHaveBeenLastCalledWith('middle');
  view.rerender(<ThreeColumnSplit {...props} layoutMode="single" defaultCompactPanel="left" />);
  expect(changed).toHaveBeenLastCalledWith('left');
});
