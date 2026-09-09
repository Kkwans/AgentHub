// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AhButton, AhChoiceSelect, AhIconButton, AhSelect } from './primitives.js';

describe('UI primitives', () => {
  it('renders a loading button without losing its accessible name', () => {
    render(
      <MantineProvider env="test">
        <AhButton loading>保存项目</AhButton>
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: '保存项目' })).toBeDisabled();
  });

  it('uses the PinHarness combobox for product entity selection', () => {
    const onChange = vi.fn();
    render(
      <MantineProvider env="test">
        <AhSelect
          label="Project"
          value="agenthub"
          onChange={onChange}
          data={[
            { value: 'agenthub', label: 'AgentHub' },
            { value: 'claude', label: 'Claude' },
          ]}
        />
      </MantineProvider>,
    );

    const trigger = screen.getByRole('combobox', { name: 'Project' });
    expect(trigger).toBeInTheDocument();
    expect(document.querySelector('select')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'AgentHub' })).toBeInTheDocument();
    const option = screen.getByRole('option', { name: 'Claude' });
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('claude');
  });

  it('keeps product choice fields non-native while preserving option descriptions', () => {
    render(
      <MantineProvider env="test">
        <AhChoiceSelect
          label="运行模式"
          value="plan"
          options={[{ value: 'plan', label: '计划', description: '先确认计划再执行' }]}
          onValueChange={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole('combobox', { name: '运行模式' })).toBeInTheDocument();
    expect(document.querySelector('select')).not.toBeInTheDocument();
  });

  it('keeps icon-only actions named and discoverable', () => {
    render(
      <MantineProvider env="test">
        <AhIconButton label="打开设置" size="sm">
          ⚙
        </AhIconButton>
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: '打开设置' })).toHaveAttribute('title', '打开设置');
  });

  it('exposes a stable loading state without changing the action name', () => {
    render(
      <MantineProvider env="test">
        <AhButton loading fullWidth rightSection={<span aria-hidden>⌘</span>}>
          发送
        </AhButton>
        <AhIconButton label="刷新" loading>
          ↻
        </AhIconButton>
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toHaveAttribute('data-loading', 'true');
    expect(screen.getByRole('button', { name: '发送' })).toHaveClass('w-full');
    expect(screen.getByRole('button', { name: '发送' })).not.toHaveClass('ah-button');
    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();
  });
});
