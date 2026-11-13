import type { editor } from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';
import { bindDiffEditorLabels, type DiffEditorLabels } from './diff-editor-labels';

const ariaOption = 8 as editor.EditorOption.ariaLabel;
function fixture(initial = '') {
  let value = initial;
  const listeners = new Set<(event: editor.ConfigurationChangedEvent) => void>();
  const disposed = new Set<() => void>();
  const emit = (ariaChanged = true) => {
    const event = {
      hasChanged: (id: number) => ariaChanged && id === ariaOption,
    } as editor.ConfigurationChangedEvent;
    for (const listener of listeners) listener(event);
  };
  const child = {
    getOption: vi.fn(() => value),
    updateOptions: vi.fn((options: editor.IEditorOptions) => {
      value = options.ariaLabel!;
      emit();
    }),
    onDidChangeConfiguration: (listener: (event: editor.ConfigurationChangedEvent) => void) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    onDidDispose: (listener: () => void) => {
      disposed.add(listener);
      return {
        dispose: () => {
          disposed.delete(listener);
        },
      };
    },
  };
  return {
    child,
    reset: (next = '') => {
      value = next;
      emit();
    },
    emit,
    destroy: () => {
      for (const callback of [...disposed]) callback();
    },
    listenerCount: () => listeners.size + disposed.size,
  };
}
function mount(
  labels: DiffEditorLabels = { original: '旧文件 a.css', modified: '新文件 a.css' },
  initial = '',
) {
  const original = fixture(initial),
    modified = fixture(initial);
  const state = { labels };
  const instance = {
    getOriginalEditor: () => original.child,
    getModifiedEditor: () => modified.child,
  };
  const binding = bindDiffEditorLabels(
    instance as unknown as editor.IStandaloneDiffEditor,
    ariaOption,
    () => state.labels,
  );
  return { original, modified, state, binding };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Monaco explicit diff label reconciliation', () => {
  it('initial blank labels are supplied to both child editors without a reentrant update loop', async () => {
    const { original, modified } = mount();
    await flush();
    expect(original.child.updateOptions).toHaveBeenCalledExactlyOnceWith({
      ariaLabel: '旧文件 a.css',
    });
    expect(modified.child.updateOptions).toHaveBeenCalledExactlyOnceWith({
      ariaLabel: '新文件 a.css',
    });
  });
  it('repairs internal empty-summary resets once after the configuration stack finishes', async () => {
    const { original } = mount();
    await flush();
    original.child.updateOptions.mockClear();
    original.reset();
    original.reset();
    expect(original.child.updateOptions).not.toHaveBeenCalled();
    await flush();
    expect(original.child.updateOptions).toHaveBeenCalledTimes(1);
    original.emit(false);
    await flush();
    expect(original.child.updateOptions).toHaveBeenCalledTimes(1);
  });
  it('does not rewrite already correct names', async () => {
    const { original, modified, binding } = mount({ original: 'same', modified: 'same' }, 'same');
    binding.refresh();
    await flush();
    expect(original.child.updateOptions).not.toHaveBeenCalled();
    expect(modified.child.updateOptions).not.toHaveBeenCalled();
  });
  it('queued work reads the latest file names rather than a previous path closure', async () => {
    const { state, binding, original } = mount();
    state.labels = { original: '旧文件 b.ts', modified: '新文件 b.ts' };
    binding.refresh();
    await flush();
    expect(original.child.updateOptions).toHaveBeenCalledExactlyOnceWith({
      ariaLabel: '旧文件 b.ts',
    });
  });
  it.each(['binding', 'editor'] as const)(
    'dispose through %s cancels queued writes and unsubscribes both children',
    async (mode) => {
      const { binding, original, modified } = mount();
      if (mode === 'binding') binding.dispose();
      else original.destroy();
      binding.refresh();
      await flush();
      expect(original.child.updateOptions).not.toHaveBeenCalled();
      expect(modified.child.updateOptions).not.toHaveBeenCalled();
      expect(original.listenerCount() + modified.listenerCount()).toBe(0);
    },
  );
  it('does not take over absent or whitespace labels; explicit names can be added and removed', async () => {
    const { binding, state, original, modified } = mount(
      { original: ' ', modified: undefined },
      'caller name',
    );
    await flush();
    original.reset('other');
    await flush();
    expect(original.child.updateOptions).not.toHaveBeenCalled();
    expect(modified.child.updateOptions).not.toHaveBeenCalled();
    state.labels = { original: 'explicit' };
    binding.refresh();
    await flush();
    expect(original.child.updateOptions).toHaveBeenCalledExactlyOnceWith({ ariaLabel: 'explicit' });
    state.labels = {};
    original.reset();
    await flush();
    expect(original.child.updateOptions).toHaveBeenCalledTimes(1);
  });
});
