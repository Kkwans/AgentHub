// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DiffEditorProps, DiffOnMount } from '@monaco-editor/react';

const state = vi.hoisted(() => ({
  bind: vi.fn(),
  refresh: vi.fn(),
  dispose: vi.fn(),
  props: vi.fn(),
  getModel: vi.fn(() => null),
}));
vi.mock('../lib/diff-editor-labels', () => ({ bindDiffEditorLabels: state.bind }));
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  return {
    DiffEditor: (props: DiffEditorProps) => {
      state.props(props);
      React.useEffect(() => {
        props.onMount?.(
          { getModel: state.getModel } as unknown as Parameters<DiffOnMount>[0],
          { editor: { EditorOption: { ariaLabel: 8 } } } as Parameters<DiffOnMount>[1],
        );
      }, [props.onMount]);
      return <div>差异编辑器</div>;
    },
  };
});
import { SafeDiffEditor } from './SafeDiffEditor';

beforeEach(() => {
  state.bind.mockReturnValue({ refresh: state.refresh, dispose: state.dispose });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('refreshes committed path labels without replacing the editor or models, then disposes its binding', async () => {
  const onMount = vi.fn();
  const view = render(
    <SafeDiffEditor
      options={{
        originalAriaLabel: '更改前：first.css',
        modifiedAriaLabel: '更改后：first.css',
        readOnly: true,
      }}
      onMount={onMount}
    />,
  );
  await waitFor(() => expect(state.bind).toHaveBeenCalledTimes(1));
  const readLabels = state.bind.mock.calls[0]![2] as () => unknown;
  expect(readLabels()).toEqual({ original: '更改前：first.css', modified: '更改后：first.css' });
  expect(onMount).toHaveBeenCalledTimes(1);
  const firstCapture = (state.props.mock.calls[0]![0] as DiffEditorProps).onMount;
  view.rerender(
    <SafeDiffEditor
      options={{
        originalAriaLabel: '更改前：next.css',
        modifiedAriaLabel: '更改后：next.css',
        readOnly: true,
      }}
      onMount={onMount}
    />,
  );
  expect(state.bind).toHaveBeenCalledTimes(1);
  expect(state.getModel).toHaveBeenCalledTimes(1);
  expect(readLabels()).toEqual({ original: '更改前：next.css', modified: '更改后：next.css' });
  expect(state.refresh).toHaveBeenCalled();
  const latest = state.props.mock.calls.at(-1)![0] as DiffEditorProps;
  expect(latest.onMount).toBe(firstCapture);
  expect(latest.keepCurrentOriginalModel).toBe(true);
  expect(latest.keepCurrentModifiedModel).toBe(true);
  expect(latest.options?.readOnly).toBe(true);
  view.unmount();
  expect(state.dispose).toHaveBeenCalledTimes(1);
});
it('does not invent labels for callers without explicit naming options', async () => {
  render(<SafeDiffEditor options={{ readOnly: true }} />);
  await waitFor(() => expect(state.bind).toHaveBeenCalledTimes(1));
  const readLabels = state.bind.mock.calls[0]![2] as () => unknown;
  expect(readLabels()).toEqual({ original: undefined, modified: undefined });
});

it('keeps a live label binding after StrictMode effect replay and refreshes it without another editor mount', async () => {
  const bindings: Array<{ refresh: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> =
    [];
  state.bind.mockImplementation(() => {
    const binding = { refresh: vi.fn(), dispose: vi.fn() };
    bindings.push(binding);
    return binding;
  });
  const view = render(
    <StrictMode>
      <SafeDiffEditor
        options={{
          originalAriaLabel: '更改前：strict.css',
          modifiedAriaLabel: '更改后：strict.css',
        }}
      />
    </StrictMode>,
  );
  await waitFor(() => expect(bindings.length).toBeGreaterThan(0));
  const active = bindings.at(-1)!;
  expect(active.dispose).not.toHaveBeenCalled();
  for (const previous of bindings.slice(0, -1)) expect(previous.dispose).toHaveBeenCalledTimes(1);
  const count = bindings.length;
  view.rerender(
    <StrictMode>
      <SafeDiffEditor
        options={{
          originalAriaLabel: '更改前：next.css',
          modifiedAriaLabel: '更改后：next.css',
        }}
      />
    </StrictMode>,
  );
  expect(bindings).toHaveLength(count);
  expect(active.refresh).toHaveBeenCalled();
  const labels = state.bind.mock.calls.at(-1)![2] as () => unknown;
  expect(labels()).toEqual({ original: '更改前：next.css', modified: '更改后：next.css' });
  expect(active.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(active.dispose).toHaveBeenCalledTimes(1);
});
