// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThinkingBlock } from './ThinkingEntry';
vi.mock('../MarkdownView', () => ({ MarkdownText: ({ text }: { text: string }) => <p>{text}</p> }));
afterEach(cleanup);

it('uses one focusable native summary without a nested interactive descendant', () => {
  const { container } = render(
    <ThinkingBlock text="检查结果" streaming={false} durationMs={32000} />,
  );
  const summary = screen.getByLabelText('思考了 32 秒，展开思考过程');
  expect(summary.tagName).toBe('SUMMARY');
  expect(summary.querySelector('button,a[href],input,select,textarea,[tabindex]')).toBeNull();
  summary.focus();
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(container.querySelector('details')).toHaveAttribute('open');
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  expect(summary).toHaveAccessibleName('思考了 32 秒，收起思考过程');
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(summary).toHaveFocus();
});
it('preserves streaming auto-open/completion auto-close and the same focused summary', () => {
  const view = render(<ThinkingBlock text="正在检查" streaming durationMs={1000} />);
  const summary = screen.getByLabelText('思考中 1 秒，收起思考过程');
  summary.focus();
  expect(view.container.querySelector('details')).toHaveAttribute('open');
  view.rerender(<ThinkingBlock text="检查完成" streaming={false} durationMs={2000} />);
  expect(screen.getByLabelText('思考了 2 秒，展开思考过程')).toBe(summary);
  expect(view.container.querySelector('details')).not.toHaveAttribute('open');
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(view.container.querySelector('details')).toHaveAttribute('open');
});
