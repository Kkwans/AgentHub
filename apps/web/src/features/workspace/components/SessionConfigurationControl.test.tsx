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
  it('将模型、运行模式和推理强度收进一个可访问的配置面板', () => {
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

    expect(screen.getByRole('button', { name: 'Session 配置' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Session 配置' }));
    expect(screen.getByRole('dialog', { name: 'Session 配置' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('gpt-5');
    expect(screen.getByRole('combobox', { name: '运行模式' })).toHaveValue('agent');
    expect(screen.getByRole('combobox', { name: '推理强度' })).toHaveValue('high');

    fireEvent.change(screen.getByRole('combobox', { name: '模型' }), {
      target: { value: 'claude' },
    });
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

    fireEvent.click(screen.getByRole('button', { name: 'Session 配置' }));
    expect(screen.getByText('agent-default')).toBeInTheDocument();
    expect(screen.getByText('只读')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
