// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownText, MarkdownView } from './MarkdownView';

describe('PinHarness Markdown surface', () => {
  it('keeps source-like hierarchy for headings, prose, code and tables', () => {
    render(
      <MarkdownView
        text={
          '# 标题\n\n正文 `cwd`。\n\n```sh\npwd\n```\n\n| key | value |\n| --- | --- |\n| cwd | /workspace |'
        }
      />,
    );

    expect(screen.getByRole('heading', { name: '标题' })).toHaveStyle({
      marginTop: '22px',
      marginBottom: '10px',
    });
    expect(screen.getAllByText('cwd')[0]).toHaveStyle({
      backgroundColor: 'hsl(var(--foreground) / 0.055)',
    });
    expect(screen.getByText('sh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制代码' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'key' })).toBeInTheDocument();
  });

  it('renders only the active streaming block with the source caret', () => {
    render(<MarkdownText text={'第一段\n\n第二段'} streaming />);

    expect(screen.getByText('第一段')).toBeInTheDocument();
    expect(screen.getByText('第二段')).toBeInTheDocument();
    expect(screen.getAllByRole('status', { name: '正在接收 Agent 回复' })).toHaveLength(1);
  });
});
