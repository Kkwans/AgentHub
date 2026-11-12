// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTaskCreationRecovery } from './useTaskCreationRecovery';
import { markerKey, saveMarker } from '../lib/task-creation-recovery';
import { authSession } from '../../../lib/api';
const project = '11111111-1111-4111-8111-111111111111';
const task = '33333333-3333-4333-8333-333333333333';
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
async function mount() {
  const view = renderHook(() => useTaskCreationRecovery(project, 'local-trusted'));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}
it('refuses stale advance and complete against advanced or differently bound records', async () => {
  const view = await mount();
  let marker!: ReturnType<typeof view.result.current.begin>;
  act(() => {
    marker = view.result.current.begin();
  });
  const advanced = { ...marker, stage: 'START_PENDING' as const, taskId: task };
  saveMarker(localStorage, advanced);
  act(() => {
    expect(() => view.result.current.advance(marker, 'TASK_CREATED', task)).toThrow();
    expect(view.result.current.complete(marker)).toBe(false);
  });
  expect(JSON.parse(localStorage.getItem(markerKey(marker))!)).toEqual(advanced);
  const rebound = { ...marker, stage: 'TASK_CREATED' as const, taskId: project };
  saveMarker(localStorage, rebound);
  act(() => {
    expect(view.result.current.complete({ ...marker, stage: 'TASK_CREATED', taskId: task })).toBe(
      false,
    );
  });
  expect(JSON.parse(localStorage.getItem(markerKey(marker))!)).toEqual(rebound);
});
it('rejects advance and complete after unmount or for another project', async () => {
  const view = await mount();
  let marker!: ReturnType<typeof view.result.current.begin>;
  act(() => {
    marker = view.result.current.begin();
  });
  act(() => {
    expect(() =>
      view.result.current.advance({ ...marker, projectId: task }, 'TASK_CREATED', task),
    ).toThrow();
  });
  const old = view.result.current;
  view.unmount();
  expect(() => old.advance(marker, 'TASK_CREATED', task)).toThrow();
  expect(old.complete(marker)).toBe(false);
  expect(localStorage.getItem(markerKey(marker))).not.toBeNull();
});
it('does not delete changed, foreign, or late confirmed records after auth invalidation', async () => {
  const view = await mount();
  let marker!: ReturnType<typeof view.result.current.begin>;
  act(() => {
    marker = view.result.current.begin();
    view.result.current.reveal();
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  const key = markerKey(marker);
  saveMarker(localStorage, { ...marker, stage: 'TASK_CREATED', taskId: task });
  act(() => view.result.current.remove(key));
  expect(localStorage.getItem(key)).not.toBeNull();
  const foreign = { ...marker, projectId: task };
  saveMarker(localStorage, foreign);
  act(() => view.result.current.remove(markerKey(foreign)));
  expect(localStorage.getItem(markerKey(foreign))).not.toBeNull();
  act(() => view.result.current.refresh());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  act(() => authSession.notifyAuthorizationRequired());
  act(() => view.result.current.remove(key));
  expect(localStorage.getItem(key)).not.toBeNull();
});
it('failed completion remains fenced when the page reopens', async () => {
  const view = await mount();
  let marker!: ReturnType<typeof view.result.current.begin>;
  act(() => {
    marker = view.result.current.begin();
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('denied');
  });
  act(() => expect(view.result.current.complete(marker)).toBe(false));
  view.unmount();
  const reopened = await mount();
  expect(reopened.result.current.blocked).toBe(true);
  act(() => expect(() => reopened.result.current.begin()).toThrow());
});
