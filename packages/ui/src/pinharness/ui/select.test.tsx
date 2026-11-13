// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Select } from './select.js';
afterEach(cleanup);
const options = [{ value: 'one', label: '选项一' }];
it('初始空受控值显示placeholder而不是无标签sentinel', () => {
  render(
    <Select
      value=""
      onValueChange={() => undefined}
      options={options}
      clearable
      placeholder="请选择目标"
      ariaLabel="目标"
    />,
  );
  expect(screen.getByRole('combobox', { name: '目标' })).toHaveTextContent('请选择目标');
});
it('选择后清除保持受控并恢复placeholder，不残留旧选择', async () => {
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <Select
        value={value}
        onValueChange={setValue}
        options={options}
        clearable
        placeholder="请选择目标"
        ariaLabel="目标"
      />
    );
  }
  render(<Harness />);
  const trigger = screen.getByRole('combobox', { name: '目标' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: '选项一' }));
  await waitFor(() => expect(trigger).toHaveTextContent('选项一'));
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: '清除选择' }));
  await waitFor(() => expect(trigger).toHaveTextContent('请选择目标'));
  expect(trigger).not.toHaveTextContent('选项一');
});
it('显式空option仍显示其label而不是placeholder', () => {
  render(
    <Select
      value=""
      onValueChange={() => undefined}
      options={[{ value: '', label: '全部目标' }, ...options]}
      clearable
      placeholder="请选择目标"
      ariaLabel="目标"
    />,
  );
  expect(screen.getByRole('combobox', { name: '目标' })).toHaveTextContent('全部目标');
  expect(screen.getByRole('combobox', { name: '目标' })).not.toHaveTextContent('请选择目标');
});
