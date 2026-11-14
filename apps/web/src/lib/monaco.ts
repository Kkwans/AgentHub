import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import typescriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

import { diffEditorThemes } from './diff-editor-theme';

type MonacoWorkerEnvironment = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker(moduleId: string, label: string): Worker;
  };
};

(globalThis as MonacoWorkerEnvironment).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new typescriptWorker();
    return new editorWorker();
  },
};

for (const [name, definition] of Object.entries(diffEditorThemes)) {
  monaco.editor.defineTheme(name, definition);
}

loader.config({ monaco });

/** Load the lazy Monarch grammar before a diff model can cache plain-text deletion zones.
 * Monaco 0.56 inline zones observe tokenization completion, not each token update.
 * Use the public colorizer with empty content: no document HTML or full-patch work.
 */
export async function prepareDiffLanguage(language: string): Promise<void> {
  await monaco.editor.colorize('', language, {});
}
