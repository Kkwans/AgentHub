// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TOOL_THEMES } from '../toolThemes';
import { ToolEntryHeader } from './ToolEntryHeader';
afterEach(cleanup);
const base = {
  hasOutput: true,
  showDetail: false,
  isActive: false,
  isFailed: false,
  theme: TOOL_THEMES.default,
  toolName: '读取代码',
  summary: '读取代码',
  resultSummary: '',
  sleepRemainingMs: null,
  filePathForOpen: null,
  onToggle: vi.fn(),
  onOpenFile: vi.fn(),
};
it('deduplicates only exact summaries and preserves original input and file action', () => {
  const props = { ...base, summary: '读取代码', filePathForOpen: 'src/main.ts' };
  const view = render(<ToolEntryHeader {...props} />);
  expect(view.container.querySelector('.tool-entry-summary')).toBeNull();
  expect(view.container.querySelector('.tool-entry-separator')).toBeNull();
  expect(screen.getByRole('button', { name: '在文件面板中打开：src/main.ts' })).toBeVisible();
  expect(props.summary).toBe('读取代码');
  view.rerender(<ToolEntryHeader {...base} summary="读取代码：src/main.ts" summaryMonospace />);
  expect(view.container.querySelector('.tool-entry-summary')).toHaveTextContent(
    '读取代码：src/main.ts',
  );
  expect(view.container.querySelector('.tool-entry-summary')).toHaveClass('font-mono');
});
it('does not conflate case or punctuation, and nontechnical summaries stay sans-serif', () => {
  const view = render(<ToolEntryHeader {...base} toolName="Read" summary="read" />);
  expect(view.container.querySelector('.tool-entry-summary')).toHaveTextContent('read');
  expect(view.container.querySelector('.tool-entry-summary')).not.toHaveClass('font-mono');
  view.rerender(<ToolEntryHeader {...base} summary="读取代码。" />);
  expect(view.container.querySelector('.tool-entry-summary')).toHaveTextContent('读取代码。');
});
it('keeps actual status, optional duration, failure text and the same expansion action', () => {
  const onToggle = vi.fn();
  const view = render(<ToolEntryHeader {...base} onToggle={onToggle} />);
  const toggle = screen.getByRole('button', { name: /工具调用完成/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveClass('min-h-11');
  fireEvent.click(toggle);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(view.container).not.toHaveTextContent(/\d+(ms|s)/);
  view.rerender(
    <ToolEntryHeader
      {...base}
      showDetail
      isFailed
      toolDurationMs={1400}
      failureSummary="公开错误：文件不存在"
    />,
  );
  expect(screen.getByRole('button', { name: /工具调用失败/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(view.container).toHaveTextContent('1.4s');
  expect(view.container).toHaveTextContent('公开错误：文件不存在');
  view.rerender(<ToolEntryHeader {...base} isActive toolDurationMs={1400} />);
  expect(screen.getByRole('button', { name: /工具执行中/ })).toBeVisible();
  expect(view.container).not.toHaveTextContent('1.4s');
});

it('preserves meaningful command/path whitespace including leading and trailing spaces', () => {
  const cases = [
    ["printf 'a b'", "printf 'a  b'"],
    ['src/a b.ts', 'src/a  b.ts'],
    ['读取代码', ' 读取代码'],
    ['读取代码', '读取代码 '],
  ];
  const view = render(<ToolEntryHeader {...base} />);
  for (const [toolName, summary] of cases) {
    view.rerender(
      <ToolEntryHeader {...base} toolName={toolName!} summary={summary!} summaryMonospace />,
    );
    expect(view.container.querySelector('.tool-entry-summary')?.textContent).toBe(summary);
  }
});
