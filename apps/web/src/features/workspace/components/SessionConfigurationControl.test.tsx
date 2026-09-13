// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionConfigurationRecord } from '../../../lib/api';
import { SessionConfigurationControl } from './SessionConfigurationControl';

afterEach(() => cleanup());

const configuration = {
  supported: true,
  current: { model: 'gpt-5', mode: 'agent', reasoningEffort: 'high' },
  options: {
    models: [
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'claude', label: 'Claude' },
    ],
    modes: [
      { id: 'agent', label: 'Agent' },
      { id: 'plan', label: 'Plan' },
    ],
    reasoningEfforts: [
      { id: 'high', label: 'High' },
      { id: 'low', label: 'Low' },
    ],
  },
} satisfies SessionConfigurationRecord;

describe('SessionConfigurationControl', () => {
  it('将模型、访问策略和推理强度分别呈现在配置面板', () => {
    const onChange = vi.fn();
    render(
      <SessionConfigurationControl
        configuration={configuration}
        loading={false}
        model="gpt-5"
        mode="agent"
        reasoningEffort="high"
        updatingModel={false}
        updatingMode={false}
        updatingReasoningEffort={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: '配置模型、访问策略和推理强度' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: '配置模型、访问策略和推理强度' }));
    expect(screen.getByRole('dialog', { name: '运行配置' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveTextContent('GPT-5');
    expect(screen.getByRole('combobox', { name: '访问策略' })).toHaveTextContent('工作区执行');
    expect(screen.getByRole('combobox', { name: '推理强度' })).toHaveTextContent('高');

    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'Claude' }));
    expect(onChange).toHaveBeenCalledWith({ model: 'claude' });
  });

  it('在 Agent 不支持配置时仍显示明确的当前值', () => {
    render(
      <SessionConfigurationControl
        configuration={{
          ...configuration,
          supported: false,
          options: { models: [], modes: [], reasoningEfforts: [] },
        }}
        loading={false}
        model="agent-default"
        mode="read-only"
        reasoningEffort=""
        updatingModel={false}
        updatingMode={false}
        updatingReasoningEffort={false}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '配置模型、访问策略和推理强度' }));
    expect(screen.getByText('agent-default')).toBeInTheDocument();
    expect(screen.getByText('只读')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
