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
  const summary = screen.getByLabelText('Agent 思考内容，展开思考内容');
  expect(summary.tagName).toBe('SUMMARY');
  expect(summary.querySelector('button,a[href],input,select,textarea,[tabindex]')).toBeNull();
  summary.focus();
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(container.querySelector('details')).toHaveAttribute('open');
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  expect(summary).toHaveAccessibleName('Agent 思考内容，收起思考内容');
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(summary).toHaveFocus();
});
it('preserves streaming auto-open/completion auto-close and the same focused summary', () => {
  const view = render(<ThinkingBlock text="正在检查" streaming durationMs={1000} />);
  const summary = screen.getByLabelText('Agent 正在提供思考内容，收起思考内容');
  summary.focus();
  expect(view.container.querySelector('details')).toHaveAttribute('open');
  view.rerender(<ThinkingBlock text="检查完成" streaming={false} durationMs={2000} />);
  expect(screen.getByLabelText('Agent 思考内容，展开思考内容')).toBe(summary);
  expect(view.container.querySelector('details')).not.toHaveAttribute('open');
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(view.container.querySelector('details')).toHaveAttribute('open');
});

it('does not present reception timestamps as inference duration or invent text', () => {
  render(<ThinkingBlock text="Provider supplied text" streaming={false} durationMs={32000} />);
  expect(screen.queryByText(/32 秒|思考了/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Agent 思考内容，展开思考内容'));
  expect(screen.getByText('Provider supplied text')).toBeVisible();
});
