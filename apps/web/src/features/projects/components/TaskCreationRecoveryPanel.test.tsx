// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskCreationRecoveryPanel } from './TaskCreationRecoveryPanel';
import type { TaskCreationRecovery } from '../hooks/useTaskCreationRecovery';
import layout from '../../shared/layout.module.css';

afterEach(cleanup);
it('keeps original task first, groups spaced actions, and requires explicit removal confirmation', () => {
  const remove = vi.fn();
  const open = vi.fn();
  const result = {
    operationId: 'operation1',
    projectId: 'project1',
    taskId: 'task1',
    status: 'BACKLOG',
    sessionId: 'session1',
  };
  const recovery = {
    blocked: true,
    loading: false,
    error: '',
    items: [{ key: 'record1', result }],
    remove,
    refresh: vi.fn(),
  } as unknown as TaskCreationRecovery;
  render(<TaskCreationRecoveryPanel recovery={recovery} open={open} />);
  const original = screen.getByRole('button', { name: '打开原任务' });
  expect(screen.getAllByRole('button')[0]).toBe(original);
  expect(original.parentElement).toHaveClass(layout.actions!);
  fireEvent.click(original);
  expect(open).toHaveBeenCalledWith(result, false);
  fireEvent.click(screen.getByRole('button', { name: '打开原工作区' }));
  expect(open).toHaveBeenCalledWith(result, true);
  fireEvent.click(screen.getByRole('button', { name: '移除此本机恢复记录' }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('重新创建可能产生重复任务');
  fireEvent.click(screen.getByRole('button', { name: '保留记录' }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '移除此本机恢复记录' }));
  fireEvent.click(screen.getByRole('button', { name: '已核对，移除此本机记录' }));
  expect(remove).toHaveBeenCalledExactlyOnceWith('record1');
});
it('retains query disabled state while recovery is loading', () => {
  const recovery = {
    blocked: true,
    loading: true,
    error: '',
    items: [],
    refresh: vi.fn(),
  } as unknown as TaskCreationRecovery;
  render(<TaskCreationRecoveryPanel recovery={recovery} open={vi.fn()} />);
  const query = screen.getByRole('button', { name: '再次查询创建结果' });
  expect(query).toBeDisabled();
  expect(query.parentElement).toHaveClass(layout.actions!);
});
