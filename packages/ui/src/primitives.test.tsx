// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AhButton, AhChoiceSelect, AhPageHeader, AhSelect, AhStatusBadge } from './primitives.js';

describe('v0.7 UI primitives', () => {
  it('renders a loading button without losing its accessible name', () => {
    render(
      <MantineProvider env="test">
        <AhButton loading>保存项目</AhButton>
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: '保存项目' })).toBeDisabled();
  });

  it('uses a searchable combobox for product entity selection', () => {
    const onChange = vi.fn();
    render(
      <MantineProvider env="test">
        <AhSelect
          label="Project"
          value="agenthub"
          onChange={onChange}
          data={[{ value: 'agenthub', label: 'AgentHub' }]}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
    expect(document.querySelector('select')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
      target: { value: 'Agent' },
    });
  });

  it('provides a stable page hierarchy and translated status labels', () => {
    render(
      <MantineProvider env="test">
        <AhPageHeader title="项目" description="管理你的工程上下文。" />
        <AhStatusBadge status="READY" />
      </MantineProvider>,
    );

    expect(screen.getByRole('heading', { name: '项目', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('就绪')).toBeInTheDocument();
    expect(screen.queryByText('READY')).not.toBeInTheDocument();
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
});
