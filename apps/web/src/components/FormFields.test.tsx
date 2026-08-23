// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Field, FormTextArea, FormTextField, SelectField } from '@agenthub/ui';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shared form fields', () => {
  it('associates descriptions and errors with the real text control', () => {
    render(
      <FormTextField
        id="project-name"
        label="Project 名称"
        description="显示在导航和列表中。"
        error="请输入 Project 名称。"
      />,
    );

    const input = screen.getByLabelText('Project 名称');
    expect(input).toHaveAttribute('name', 'project-name');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute(
      'aria-describedby',
      'project-name-description project-name-error',
    );
  });

  it('keeps custom controls inside Field accessible', () => {
    render(
      <Field label="运行环境" htmlFor="runtime" description="选择 Agent 所在的位置。">
        <select id="runtime" defaultValue="local">
          <option value="local">本机</option>
        </select>
      </Field>,
    );

    const select = screen.getByLabelText('运行环境');
    expect(select).toHaveAttribute('aria-describedby', 'runtime-description');
  });

  it('gives text areas a stable name and avoids password-manager autofill', () => {
    render(
      <FormTextArea id="description" label="说明" rows={3} />,
    );

    const textarea = screen.getByLabelText('说明');
    expect(textarea).toHaveAttribute('name', 'description');
    expect(textarea).toHaveAttribute('autocomplete', 'off');
  });

  it('preserves explicit select labels and values', () => {
    render(
      <SelectField
        id="agent"
        label="Agent"
        value="codex"
        options={[{ value: 'codex', label: 'Codex' }]}
      />,
    );

    expect(screen.getByLabelText('Agent')).toHaveValue('Codex');
    expect(document.querySelector('select')).not.toBeInTheDocument();
  });
});
