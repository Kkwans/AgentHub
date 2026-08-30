import { AgentHubThemeContext, ChevronDown, FileCode2, Files } from '@agenthub/ui';
import { useContext, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';

import { EmptyState, ErrorState, LoadingState } from '../../../components/Common';
import type { FileEntry } from '../../../lib/api';
import type { QueryState } from '../workspace-types';

export function FileInspector({
  selected,
  onSelect,
  files,
  content,
}: {
  selected: string | undefined;
  onSelect: (path: string) => void;
  files: QueryState<FileEntry[]>;
  content: QueryState<{ content: string; path: string }>;
}) {
  const theme = useContext(AgentHubThemeContext);
  const mode =
    theme?.mode ??
    (typeof document !== 'undefined' && document.documentElement.dataset.agenthubTheme === 'dark'
      ? 'dark'
      : 'light');
  const [monacoReady, setMonacoReady] = useState(false);
  useEffect(() => {
    let active = true;
    void import('../../../lib/monaco').then(() => {
      if (active) setMonacoReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="file-inspector">
      <div className="file-tree">
        <div className="mini-heading">
          <Files size={14} /> 文件树
        </div>
        {files.isLoading ? (
          <LoadingState />
        ) : files.error ? (
          <ErrorState error={files.error} retry={() => files.refetch()} />
        ) : !monacoReady ? (
          <LoadingState label="正在准备文件预览" />
        ) : (
          <FileNodes entries={files.data ?? []} selected={selected} onSelect={onSelect} />
        )}
      </div>
      <div className="editor-frame">
        {!selected ? (
          <EmptyState title="选择文件" description="文件内容以只读方式显示。" />
        ) : content.isLoading ? (
          <LoadingState />
        ) : content.error ? (
          <ErrorState error={content.error} retry={() => content.refetch()} />
        ) : (
          <Editor
            height="100%"
            path={selected}
            value={content.data?.content ?? ''}
            theme={mode === 'dark' ? 'vs-dark' : 'vs-light'}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}

function FileNodes({
  entries,
  selected,
  onSelect,
}: {
  entries: FileEntry[];
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="file-nodes">
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            className={entry.path === selected ? 'selected' : ''}
            disabled={entry.blocked || entry.type !== 'FILE'}
            onClick={() => onSelect(entry.path)}
          >
            {entry.type === 'DIRECTORY' ? <ChevronDown size={13} /> : <FileCode2 size={13} />}
            <span>{entry.name}</span>
            {entry.blocked && <small>已阻止</small>}
          </button>
          {entry.children && (
            <FileNodes entries={entry.children} selected={selected} onSelect={onSelect} />
          )}
        </div>
      ))}
    </div>
  );
}
