import { useEffect, useRef } from 'react';
import {
  DiffEditor,
  type DiffEditorProps,
  type DiffOnMount,
  type MonacoDiffEditor,
} from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

type SafeDiffEditorProps = Omit<
  DiffEditorProps,
  'keepCurrentOriginalModel' | 'keepCurrentModifiedModel'
>;

export function SafeDiffEditor({ onMount, ...props }: SafeDiffEditorProps) {
  const models = useRef<Array<editor.ITextModel>>([]);

  const captureModels: DiffOnMount = (instance, monaco) => {
    models.current = getModels(instance);
    onMount?.(instance, monaco);
  };

  useEffect(
    () => () => {
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
