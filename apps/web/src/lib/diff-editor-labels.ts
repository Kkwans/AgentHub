import type { editor, IDisposable } from 'monaco-editor';

export type DiffEditorLabels = { original?: string | undefined; modified?: string | undefined };

/**
 * Monaco 0.56's DiffEditor can propagate an empty change-summary to its child
 * editors and overwrite ariaLabel. Reconcile explicit host labels through the
 * public editor API, after its current configuration event has finished.
 */
export function bindDiffEditorLabels(
  instance: Pick<editor.IStandaloneDiffEditor, 'getOriginalEditor' | 'getModifiedEditor'>,
  ariaLabelOption: editor.EditorOption.ariaLabel,
  getLabels: () => DiffEditorLabels,
): { refresh(): void; dispose(): void } {
  const sides = [
    ['original', instance.getOriginalEditor()],
    ['modified', instance.getModifiedEditor()],
  ] as const;
  const subscriptions: IDisposable[] = [];
  let disposed = false;
  let queued = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const subscription of subscriptions) subscription.dispose();
  }

  function refresh() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      const labels = getLabels();
      for (const [side, child] of sides) {
        if (disposed) return;
        const label = labels[side];
        // Missing labels are not permission to replace another caller's name.
        if (!label?.trim() || child.getOption(ariaLabelOption) === label) continue;
        child.updateOptions({ ariaLabel: label });
      }
    });
  }

  for (const [side, child] of sides) {
    subscriptions.push(
      child.onDidChangeConfiguration((event) => {
        if (disposed || !event.hasChanged(ariaLabelOption)) return;
        const label = getLabels()[side];
        if (label?.trim() && child.getOption(ariaLabelOption) !== label) refresh();
      }),
      child.onDidDispose(dispose),
    );
  }
  refresh();
  return { refresh, dispose };
}
