import { AhButton } from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { authSession } from '../../../lib/api';
import { readTaskStartAttempts, taskStartPhases } from '../lib/task-start-attempts';
import styles from './taskStartAttemptsPanel.module.css';

type Props = { projectId: string; taskId: string; scope: string | null };
export function TaskStartAttemptsPanel(props: Props) {
  return (
    <ScopedPanel key={JSON.stringify([props.scope, props.projectId, props.taskId])} {...props} />
  );
}
function ScopedPanel({ projectId, taskId, scope }: Props) {
  const live = useRef(true);
  const revoked = useRef(false);
  const busy = useRef(false);
  const [unavailable, setUnavailable] = useState(!scope);
  useEffect(() => {
    live.current = true;
    const stop = authSession.onAuthorizationRequired(() => {
      revoked.current = true;
      setUnavailable(true);
    });
    return () => {
      live.current = false;
      stop();
    };
  }, []);
  const query = useQuery({
    queryKey: ['task-start-attempts', scope, projectId, taskId],
    queryFn: () =>
      readTaskStartAttempts(
        projectId,
        taskId,
        () => live.current && !revoked.current && Boolean(scope),
      ),
    enabled: false,
    retry: false,
    gcTime: 0,
  });
  const check = async () => {
    if (!scope || !live.current || revoked.current || busy.current) return;
    busy.current = true;
    try {
      await query.refetch();
    } finally {
      busy.current = false;
    }
  };
  return (
    <section className={styles.panel} aria-label="任务启动记录">
      <h4>启动记录</h4>
      <p>只查询原尝试，不会启动 Agent 或解除未决操作。</p>
      <AhButton
        size="xs"
        variant="light"
        disabled={unavailable || query.isFetching}
        onClick={() => void check()}
      >
        {query.isFetching ? '正在查询启动记录…' : '查询启动记录'}
      </AhButton>
      {unavailable ? (
        <p role="alert">登录状态已变化，请重新进入任务后查询。</p>
      ) : (
        <>
          {query.isFetching ? <p role="status">正在读取原任务与启动记录…</p> : null}
          {query.isError ? (
            <p role="alert">无法确认启动记录。{query.error.message} 查询失败不代表原操作未执行。</p>
          ) : null}
          {query.isSuccess && !query.isFetching && query.data.length === 0 ? (
            <p role="status">未查到启动记录；这不能证明原操作未执行，请勿据此重复启动。</p>
          ) : null}
          {query.isSuccess && !query.isFetching && query.data.length > 0 ? (
            <>
              <p>以下是历史记录，不代表当前执行状态。查询不会改变任务状态。</p>
              <ol className={styles.records}>
                {query.data.map((item) => (
                  <li key={item.attemptId}>
                    <strong>
                      {item.kind === 'START' ? '首次启动' : '继续修改'} ·{' '}
                      {taskStartPhases[item.phase]}
                    </strong>
                    <details>
                      <summary>查看操作标识与时间</summary>
                      <dl>
                        <dt>尝试编号</dt>
                        <dd>{item.attemptId}</dd>
                        <dt>Session</dt>
                        <dd>{item.sessionId}</dd>
                        <dt>Run</dt>
                        <dd>{item.runId ?? '尚未记录'}</dd>
                        <dt>记录阶段</dt>
                        <dd>{item.phase}</dd>
                        <dt>安全错误码</dt>
                        <dd>{item.errorCode ?? '无记录'}</dd>
                        <dt>创建时间</dt>
                        <dd>{item.createdAt}</dd>
                        <dt>更新时间</dt>
                        <dd>{item.updatedAt}</dd>
                      </dl>
                    </details>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
