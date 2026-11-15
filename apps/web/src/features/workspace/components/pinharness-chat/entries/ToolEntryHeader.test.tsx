// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TOOL_THEMES } from '../toolThemes';
import { ToolEntryHeader } from './ToolEntryHeader';
import { ToolUseEntry } from './ToolUseEntry';
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

it('displays a supplied file basename but keeps its full title and original open action', () => {
  const onOpenFile = vi.fn();
  const props = {
    ...base,
    summary: '…/long/project/runner.ts',
    summaryFilePath: '/tmp/long/project/runner.ts',
    filePathForOpen: '/tmp/long/project/runner.ts',
    onOpenFile,
  };
  const view = render(<ToolEntryHeader {...props} />);
  const summary = view.container.querySelector('.tool-entry-summary');
  expect(summary?.textContent).toBe('runner.ts');
  expect(summary).toHaveAttribute('title', '/tmp/long/project/runner.ts');
  fireEvent.click(
    screen.getByRole('button', { name: '在文件面板中打开：/tmp/long/project/runner.ts' }),
  );
  expect(onOpenFile).toHaveBeenCalledTimes(1);
  expect(props.summary).toBe('…/long/project/runner.ts');
});
it('never treats ordinary slash-containing summaries as filenames and keeps Windows filename spaces', () => {
  const view = render(
    <ToolEntryHeader {...base} summary="cat /tmp/very/long/file.ts" summaryMonospace />,
  );
  expect(view.container.querySelector('.tool-entry-summary')?.textContent).toBe(
    'cat /tmp/very/long/file.ts',
  );
  expect(view.container.querySelector('.tool-entry-summary')).not.toHaveAttribute('title');
  view.rerender(
    <ToolEntryHeader
      {...base}
      summary="C:\\project\\  file name.ts "
      summaryFilePath="C:\\project\\  file name.ts "
    />,
  );
  expect(view.container.querySelector('.tool-entry-summary')?.textContent).toBe('  file name.ts ');
});

it('keeps existing edit open-path precedence independent of basename summary precedence', () => {
  const onOpenDiff = vi.fn();
  const rawInput = Object.freeze({
    target_file: '/action/original.ts',
    file_path: '/summary/visible.ts',
  });
  const view = render(
    <ToolUseEntry
      entry={{
        id: 'dual',
        type: 'tool_use',
        entry: {
          id: 'dual',
          entryType: 'tool_use',
          content: '',
          messageId: 'm',
          timestamp: 0,
          streaming: false,
          toolTitle: 'Edit',
          toolKind: 'edit',
          toolStatus: 'completed',
          rawInput,
        },
      }}
      onOpenFile={undefined}
      onOpenDiff={onOpenDiff}
    />,
  );
  expect(view.container.querySelector('.tool-entry-summary')?.textContent).toBe('visible.ts');
  expect(view.container.querySelector('.tool-entry-summary')).toHaveAttribute(
    'title',
    '/summary/visible.ts',
  );
  fireEvent.click(screen.getByRole('button', { name: '在文件面板中打开：/action/original.ts' }));
  expect(onOpenDiff).toHaveBeenCalledWith('/action/original.ts');
  expect(rawInput.file_path).toBe('/summary/visible.ts');
});

it('retains full command and file identity as an accessible description without disturbing adjacent file action', () => {
  const command = 'printf "' + 'long command '.repeat(20) + '"';
  const view = render(<ToolEntryHeader {...base} summary="printf …" summaryFullText={command} />);
  expect(screen.getByRole('button', { name: /读取代码/ })).toHaveAccessibleDescription(command);
  view.rerender(
    <ToolEntryHeader
      {...base}
      summary="long/path/file.ts"
      summaryFilePath="long/path/file.ts"
      filePathForOpen="long/path/file.ts"
    />,
  );
  expect(screen.getByRole('button', { name: /^读取代码/ })).toHaveAccessibleDescription(
    'long/path/file.ts',
  );
  expect(view.container.querySelector('.tool-entry-summary')).toHaveTextContent('file.ts');
  expect(
    view.container.querySelector('.tool-entry-trigger > button + button'),
  ).toHaveAccessibleName('在文件面板中打开：long/path/file.ts');
});
it('only stacks summary-bearing title rows within the phone breakpoint', () => {
  const css = readFileSync(
    new NodeURL('../../../../../../../../packages/ui/src/pinharness.css', import.meta.url),
    'utf8',
  );
  const rule = css.slice(css.indexOf('/* Phone tool rows preserve action'));
  expect(rule).toContain('@media (max-width: 767px)');
  expect(rule).toMatch(
    /\.tool-entry-title-row:has\(\.tool-entry-summary\)\s*\{[^}]*flex-direction: column/,
  );
  expect(rule).toMatch(/> \.tool-entry-badge\s*\{[^}]*max-width: 100%/);
});

it('keeps the disclosure focus outline inside its clipped header without changing file actions', () => {
  render(<ToolEntryHeader {...base} summary="src/main.ts" filePathForOpen="src/main.ts" />);
  expect(screen.getByRole('button', { name: /工具调用完成/ })).toHaveClass('tool-entry-toggle');
  expect(screen.getByRole('button', { name: '在文件面板中打开：src/main.ts' })).not.toHaveClass(
    'tool-entry-toggle',
  );
  const css = readFileSync(
    new NodeURL('../../../../../../../../packages/ui/src/pinharness.css', import.meta.url),
    'utf8',
  );
  expect(css).toMatch(/\.tool-entry-trigger--interactive:focus-visible\s*\{[^}]*box-shadow: inset/);
  expect(css).toMatch(
    /\.tool-entry-toggle:focus-visible\s*\{[^}]*outline: 2px solid hsl\(var\(--primary\)\);[^}]*outline-offset: -2px;[^}]*box-shadow: none;/,
  );
});
