import { AgentHubThemeContext } from '@agenthub/ui';
import { useContext, useEffect, useMemo, useState } from 'react';

import { EmptyState, LoadingState } from '../../../components/Common';
import { SafeDiffEditor } from '../../../components/SafeDiffEditor';

export function DiffViewer({
  patch,
  truncated,
  path,
}: {
  patch: string;
  truncated: boolean;
  path?: string | undefined;
}) {
  const theme = useContext(AgentHubThemeContext);
  const [monacoReady, setMonacoReady] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const parsed = useMemo(() => parseUnifiedPatch(patch), [patch]);
  const language = languageForPath(path);
  useEffect(() => {
    let active = true;
    void import('../../../lib/monaco').then(() => {
      if (active) setMonacoReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!patch) return <EmptyState title="没有 Diff" description="当前范围没有可显示的内容。" />;
  if (!monacoReady) return <LoadingState label="正在准备 Diff 预览" />;
  return (
    <div className="git-diff-editor" data-truncated={truncated ? 'true' : 'false'}>
      <div className="git-diff-editor-toolbar">
        <span>文件 Diff</span>
        <button
          type="button"
          aria-pressed={sideBySide}
          aria-label={sideBySide ? '切换为统一 Diff' : '切换为分栏 Diff'}
          onClick={() => setSideBySide((current) => !current)}
        >
          {sideBySide ? '分栏' : '统一'}
        </button>
      </div>
      <SafeDiffEditor
        height="100%"
        language={language}
        original={parsed.original}
        modified={parsed.modified}
        theme={theme?.mode === 'dark' ? 'vs-dark' : 'vs-light'}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          renderSideBySide: sideBySide,
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
          lineNumbersMinChars: 3,
        }}
      />
      {truncated && <small>Diff 过大，当前仅显示前 4 MiB。</small>}
    </div>
  );
}

export function languageForPath(path: string | undefined): string {
  const extension = path?.split('.').at(-1)?.toLocaleLowerCase();
  if (!extension) return 'plaintext';
  const languages: Record<string, string> = {
    bash: 'shell',
    c: 'c',
    cc: 'cpp',
    cjs: 'javascript',
    cpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    go: 'go',
    h: 'c',
    hpp: 'cpp',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    kt: 'kotlin',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rs: 'rust',
    scss: 'scss',
    sh: 'shell',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'typescript',
    vue: 'html',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languages[extension] ?? 'plaintext';
}

function parseUnifiedPatch(patch: string): { original: string; modified: string } {
  const original: string[] = [];
  const modified: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ') || line.startsWith('index ')) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@ ')) {
      original.push(line);
      modified.push(line);
      continue;
    }
    if (line.startsWith('+')) {
      modified.push(line.slice(1));
    } else if (line.startsWith('-')) {
      original.push(line.slice(1));
    } else if (line.startsWith('\\ No newline')) {
      original.push(line);
      modified.push(line);
    } else {
      const value = line.startsWith(' ') ? line.slice(1) : line;
      original.push(value);
      modified.push(value);
    }
  }
  return { original: original.join('\n'), modified: modified.join('\n') };
}
