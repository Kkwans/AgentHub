import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AhButton, AhErrorState, AhLoadingState, AhSelect } from '@agenthub/ui';

import {
  api,
  type DirectoryListingRecord,
  type ProjectCandidateRecord,
  type WorkspaceRootRecord,
} from '../../../lib/api';
import styles from './projectDirectoryPicker.module.css';

interface PickerProps {
  targetId: string;
  selectedPath: string;
  disabled: boolean;
  onSelect: (path: string) => void;
}

/** Only paths returned by authorized filesystem APIs can be selected. */
export function ProjectDirectoryPicker(props: PickerProps) {
  const [rootId, setRootId] = useState('');
  const roots = useQuery({
    queryKey: ['filesystem-roots', props.targetId],
    queryFn: () =>
      api.get<WorkspaceRootRecord[]>(`/execution-targets/${props.targetId}/filesystem/roots`),
    enabled: Boolean(props.targetId),
  });
  const root = roots.data?.find((item) => item.rootId === rootId) ?? roots.data?.[0];
  if (!props.targetId) return <p>请先选择运行环境。</p>;
  if (roots.isLoading) return <AhLoadingState label="正在读取授权目录" rows={1} />;
  if (roots.error)
    return (
      <AhErrorState
        title="无法读取授权目录"
        description={roots.error.message}
        retry={() => void roots.refetch()}
      />
    );
  if (!root) return <p role="status">当前运行环境没有可访问的授权目录，请先检查工作区配置。</p>;
  return (
    <div className={styles.picker}>
      <AhSelect
        label="授权根目录"
        value={root.rootId}
        data={(roots.data ?? []).map((item) => ({
          value: item.rootId,
          label: `${item.label} · ${item.path}`,
        }))}
        clearable={false}
        disabled={props.disabled || roots.isFetching}
        onChange={(value) => {
          if (value && value !== root.rootId) {
            props.onSelect('');
            setRootId(value);
          }
        }}
      />
      <RootBrowser
        key={`${props.targetId}:${root.rootId}`}
        {...props}
        root={root}
        disabled={props.disabled || roots.isFetching}
      />
    </div>
  );
}

function RootBrowser({
  targetId,
  root,
  selectedPath,
  disabled,
  onSelect,
}: PickerProps & { root: WorkspaceRootRecord }) {
  const [trail, setTrail] = useState<string[]>([]);
  const path = trail.at(-1) ?? root.path;
  const query = new URLSearchParams({ root: root.rootId, path });
  const directories = useQuery({
    queryKey: ['project-directory', targetId, root.rootId, path],
    queryFn: () =>
      api.get<DirectoryListingRecord>(
        `/execution-targets/${targetId}/filesystem/directories?${query.toString()}`,
      ),
  });
  const candidates = useQuery({
    queryKey: ['project-candidates', targetId, root.rootId],
    queryFn: () =>
      api.get<ProjectCandidateRecord[]>(
        `/execution-targets/${targetId}/project-candidates?${new URLSearchParams({ root: root.rootId }).toString()}`,
      ),
  });
  const entries = directories.data?.entries.filter((entry) => entry.type !== 'FILE') ?? [];
  return (
    <>
      <section aria-label="浏览授权目录" className={styles.section}>
        <div className={styles.heading}>
          <strong>浏览目录</strong>
          <AhButton
            size="sm"
            variant="default"
            disabled={disabled || trail.length === 0}
            onClick={() => setTrail((current) => current.slice(0, -1))}
          >
            返回上一级
          </AhButton>
        </div>
        <code className={styles.path}>{path}</code>
        {directories.isLoading ? <AhLoadingState label="正在读取子目录" rows={1} /> : null}
        {directories.error ? (
          <AhErrorState
            title="无法读取子目录"
            description={directories.error.message}
            retry={() => void directories.refetch()}
          />
        ) : directories.data ? (
          <>
            <AhButton
              variant="light"
              disabled={disabled || directories.isFetching}
              onClick={() => onSelect(directories.data.path)}
            >
              选择当前目录
            </AhButton>
            {entries.length ? (
              <ul className={styles.list}>
                {entries.map((entry) => (
                  <li key={entry.path}>
                    <AhButton
                      variant="default"
                      className={styles.entry}
                      aria-label={`${entry.accessible ? '进入目录' : '不可访问目录'} ${entry.name}`}
                      disabled={disabled || directories.isFetching || !entry.accessible}
                      onClick={() => setTrail((current) => [...current, entry.path])}
                    >
                      <span>
                        {entry.name}
                        {entry.type === 'SYMLINK' ? '（链接）' : ''}
                      </span>
                      <span>{entry.accessible ? '进入' : '不可访问'}</span>
                    </AhButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status">当前目录没有可浏览的子目录，仍可选择当前目录。</p>
            )}
          </>
        ) : null}
      </section>
      <section aria-label="已发现项目" className={styles.section}>
        <strong>已发现的项目</strong>
        <p>可以直接选择已识别的仓库；未发现的工程可在上方逐级浏览。</p>
        {candidates.isLoading ? <AhLoadingState label="正在发现项目" rows={1} /> : null}
        {candidates.error ? (
          <AhErrorState
            title="项目发现失败，仍可浏览目录"
            description={candidates.error.message}
            retry={() => void candidates.refetch()}
          />
        ) : candidates.data ? (
          candidates.data.length ? (
            <ul className={styles.list}>
              {candidates.data.map((candidate) => (
                <li key={candidate.rootPath}>
                  <AhButton
                    variant={selectedPath === candidate.rootPath ? 'light' : 'default'}
                    aria-pressed={selectedPath === candidate.rootPath}
                    className={styles.entry}
                    disabled={disabled || candidates.isFetching || !candidate.readable}
                    onClick={() => onSelect(candidate.rootPath)}
                  >
                    <span>
                      {candidate.name}
                      <small>{candidate.relativePath || candidate.rootPath}</small>
                    </span>
                    <span>{candidate.readable ? '选择' : '不可读取'}</span>
                  </AhButton>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">此授权目录尚未发现项目。</p>
          )
        ) : null}
      </section>
    </>
  );
}
