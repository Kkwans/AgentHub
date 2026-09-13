import {
  AgentHubThemeContext,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Files,
  Skeleton,
} from '@agenthub/ui';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import Editor from '@monaco-editor/react';

import { EmptyState, ErrorState } from '../../../components/Feedback';
import { ApiError, type FileEntry } from '../../../lib/api';
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
  const contentErrorTitle = content.error ? fileErrorTitle(content.error) : undefined;
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
          <InspectorState>
            <FileTreeLoadingState />
          </InspectorState>
        ) : files.error ? (
          <InspectorState>
            <ErrorState error={files.error} retry={() => files.refetch()} />
          </InspectorState>
        ) : (
          <FileNodes entries={files.data ?? []} selected={selected} onSelect={onSelect} />
        )}
      </div>
      <div className="editor-frame">
        {!selected ? (
          <InspectorState>
            <EmptyState title="选择文件" description="文件内容以只读方式显示。" />
          </InspectorState>
        ) : content.isLoading ? (
          <InspectorState>
            <FilePreviewLoadingState label="正在读取文件内容" />
          </InspectorState>
        ) : content.error ? (
          <InspectorState>
            <ErrorState
              error={content.error}
              retry={() => content.refetch()}
              {...(contentErrorTitle ? { title: contentErrorTitle } : {})}
            />
          </InspectorState>
        ) : !monacoReady ? (
          <InspectorState>
            <FilePreviewLoadingState label="正在准备文件预览" />
          </InspectorState>
        ) : (
          <>
            <div className="file-preview-header">
              <FileCode2 size={13} aria-hidden="true" />
              <span title={content.data?.path ?? selected}>{content.data?.path ?? selected}</span>
              <small>只读</small>
            </div>
            <div className="file-preview-editor">
              <Editor
                height="100%"
                path={selected}
                value={content.data?.content ?? ''}
                theme={mode === 'dark' ? 'vs-dark' : 'vs-light'}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineHeight: 21,
                  lineNumbersMinChars: 3,
                  padding: { top: 10, bottom: 10 },
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'none',
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InspectorState({ children }: { children: ReactNode }) {
  return <div className="file-inspector-state">{children}</div>;
}

function FileTreeLoadingState() {
  return (
    <div
      className="file-pane-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="正在读取文件树"
    >
      <div className="file-pane-loading-copy">
        <strong>正在读取文件树</strong>
        <span>从当前 Project 读取可访问路径</span>
      </div>
      <div className="file-pane-skeleton-lines" aria-hidden="true">
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-11/12" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-4/5" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-5/6" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-3/4" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-2/3" />
      </div>
    </div>
  );
}

function FilePreviewLoadingState({ label }: { label: string }) {
  return (
    <div
      className="file-pane-loading file-pane-loading--editor"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="file-pane-loading-copy">
        <strong>{label}</strong>
        <span>保持只读预览布局</span>
      </div>
      <div className="file-pane-code-skeleton" aria-hidden="true">
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-4/5" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-full" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-11/12" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-3/4" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-5/6" />
        <Skeleton className="file-pane-skeleton-row skeleton-shimmer h-3 w-2/3" />
      </div>
    </div>
  );
}

function fileErrorTitle(error: Error): string | undefined {
  if (
    error instanceof ApiError &&
    ['PATH_ABSOLUTE_FORBIDDEN', 'PATH_TRAVERSAL', 'PATH_INVALID', 'PATH_ENCODING_INVALID'].includes(
      error.code,
    )
  ) {
    return '文件路径不在当前 Project 内';
  }
  return undefined;
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
        <FileNode key={entry.path} entry={entry} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

function FileNode({
  entry,
  selected,
  onSelect,
}: {
  entry: FileEntry;
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const directory = entry.type === 'DIRECTORY';
  return (
    <div className="file-node">
      <button
        className={entry.path === selected ? 'selected' : ''}
        disabled={entry.blocked}
        aria-expanded={directory ? expanded : undefined}
        onClick={() => {
          if (directory) setExpanded((value) => !value);
          else onSelect(entry.path);
        }}
      >
        {directory ? (
          expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )
        ) : (
          <FileCode2 size={13} />
        )}
        <span>{entry.name}</span>
        {entry.blocked && <small>已阻止</small>}
      </button>
      {directory && expanded && entry.children?.length ? (
        <FileNodes entries={entry.children} selected={selected} onSelect={onSelect} />
      ) : null}
    </div>
  );
}
