import { AhStatusPill, ChevronRight } from '@agenthub/ui';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { SessionRecord } from '../../../lib/api';
import { displayDate } from '../../shared/page-primitives';
import styles from './SessionContextRow.module.css';

/** Display only; never normalize the path used by the session or its navigation. */
export function sessionDirectoryLabel(path: string | null | undefined): string {
  if (!path?.trim()) return '目录未记录';
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return '/';
  if (/^[a-z]:[\\/]+$/i.test(path)) return `${normalized}/`;
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function SessionContextRow({
  session,
  agentName,
}: {
  session: SessionRecord;
  agentName?: string | undefined;
}) {
  const titleId = useId();
  const agent = agentName || (session.agentId ? 'Agent 信息未知' : '未绑定 Agent');
  const branch = session.branch || '分支未记录';
  const model = session.model || '模型未记录';
  const directory = session.cwd || '目录未记录';
  const lastActive = session.lastActiveAt;
  return (
    <article className={styles.row} aria-labelledby={titleId}>
      <Link className={styles.primaryLink} to={`/workspace/${session.id}`}>
        <span className={styles.avatar} aria-hidden="true">
          {agentName?.slice(0, 1).toUpperCase() ?? 'A'}
        </span>
        <span className={styles.main}>
          <strong className={styles.title} id={titleId}>
            {session.title}
          </strong>
          <span className={styles.context}>
            <span className={styles.piece}>
              <span className={styles.label}>Agent</span>
              <span className={styles.value}>{agent}</span>
            </span>
            <span className={styles.piece}>
              <span className={styles.label}>分支</span>
              <span className={styles.value}>{branch}</span>
            </span>
            <span className={`${styles.piece} ${styles.directory}`}>
              <span className={styles.label}>目录</span>
              <span className={styles.value}>{sessionDirectoryLabel(session.cwd)}</span>
            </span>
          </span>
        </span>
        <span className={styles.metadata}>
          <AhStatusPill status={session.status} />
          <span className={styles.updated}>
            {lastActive && !Number.isNaN(Date.parse(lastActive)) ? (
              <time dateTime={lastActive}>最近活动 {displayDate(lastActive)}</time>
            ) : (
              '暂无活动时间'
            )}
          </span>
        </span>
      </Link>
      <details className={styles.details}>
        <summary className={styles.summary} aria-label={`查看会话上下文：${session.title}`}>
          <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
          上下文
        </summary>
        <dl className={styles.fields}>
          <dt>标题</dt>
          <dd>{session.title}</dd>
          <dt>Agent</dt>
          <dd>{agent}</dd>
          <dt>模型</dt>
          <dd>
            <code>{model}</code>
          </dd>
          <dt>分支</dt>
          <dd>
            <code>{branch}</code>
          </dd>
          <dt>目录</dt>
          <dd>
            <code>{directory}</code>
          </dd>
        </dl>
      </details>
    </article>
  );
}
