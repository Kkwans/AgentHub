// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../lib/api';
import { InlineError } from './Common';

afterEach(cleanup);

describe('InlineError', () => {
  it('announces mutation failures with a Chinese action title and message', () => {
    render(
      <InlineError
        title="接入失败"
        error={
          new ApiError(
            'AGENT_CANDIDATE_NOT_ADOPTABLE',
            '当前 Agent 不能接入，请先处理运行环境状态。',
            409,
          )
        }
      />,
    );

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('接入失败')).toBeInTheDocument();
    expect(screen.getByText('当前 Agent 不能接入，请先处理运行环境状态。')).toBeInTheDocument();
  });

  it('uses a safe fallback when a mutation does not return an Error', () => {
    render(<InlineError error={null} />);

    expect(screen.getByRole('alert')).toHaveTextContent('请检查当前状态后重试。');
  });
});
