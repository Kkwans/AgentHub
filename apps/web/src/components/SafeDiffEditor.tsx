import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  DiffEditor,
  type DiffEditorProps,
  type DiffOnMount,
  type MonacoDiffEditor,
} from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { bindDiffEditorLabels } from '../lib/diff-editor-labels';

type SafeDiffEditorProps = Omit<
  DiffEditorProps,
  'keepCurrentOriginalModel' | 'keepCurrentModifiedModel'
>;

export function SafeDiffEditor({ onMount, ...props }: SafeDiffEditorProps) {
  const models = useRef<Array<editor.ITextModel>>([]);
  const labelBinding = useRef<ReturnType<typeof bindDiffEditorLabels> | null>(null);
  const optionsRef = useRef(props.options);
  const onMountRef = useRef(onMount);

  useLayoutEffect(() => {
    optionsRef.current = props.options;
    onMountRef.current = onMount;
    labelBinding.current?.refresh();
  }, [props.options, onMount]);

  const captureModels = useCallback<DiffOnMount>((instance, monaco) => {
    models.current = getModels(instance);
    labelBinding.current?.dispose();
    labelBinding.current = bindDiffEditorLabels(
      instance,
      monaco.editor.EditorOption.ariaLabel,
      () => ({
        original: optionsRef.current?.originalAriaLabel,
        modified: optionsRef.current?.modifiedAriaLabel,
      }),
    );
    onMountRef.current?.(instance, monaco);
  }, []);

  useEffect(
    () => () => {
      labelBinding.current?.dispose();
      labelBinding.current = null;
      const staleModels = [...models.current];
      globalThis.setTimeout(() => {
        for (const model of new Set(staleModels)) {
          if (!model.isDisposed()) model.dispose();
        }
      }, 0);
    },
    [],
  );

  return (
    <DiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={captureModels}
    />
  );
}

function getModels(instance: MonacoDiffEditor): Array<editor.ITextModel> {
  const model = instance.getModel();
  return model ? [model.original, model.modified] : [];
}
