import { useState } from 'react';
import { AhButton } from '@agenthub/ui';
import type { TaskCreationRecovery } from '../hooks/useTaskCreationRecovery';
import type { RecoveredTask } from '../lib/task-creation-recovery';
import layout from '../../shared/layout.module.css';
export function TaskCreationRecoveryPanel({
  recovery,
  open,
}: {
  recovery: TaskCreationRecovery;
  open: (result: RecoveredTask, workspace: boolean) => void;
}) {
  const [confirm, setConfirm] = useState<string>();
  if (!recovery.blocked) return null;
  return (
    <section className={layout.mutedBox} aria-label="任务创建恢复">
      <strong>先核对上次创建结果</strong>
      <p>
        重新打开时只查询原操作，不会自动创建任务或启动 Agent。本机仅保存操作编号，不保存正文、Prompt
        变量或凭据。
      </p>
      {recovery.loading ? <p role="status">正在读取创建恢复记录…</p> : null}
      {recovery.error ? <p role="alert">{recovery.error}</p> : null}
      <div className={layout.stack}>
        {recovery.items.map((item) => (
          <div key={item.key}>
            {item.marker ? (
              <p>
                操作编号：<code>{item.marker.operationId}</code>
              </p>
            ) : null}
            {item.error ? <p role="alert">{item.error}</p> : null}
            {item.result ? <p>已找到原任务；请手动查看结果。</p> : null}
            {confirm === item.key ? (
              <p role="alert">
                移除本机记录不会取消服务器请求。请先核对任务列表，重新创建可能产生重复任务。
              </p>
            ) : null}
            <div className={layout.actions}>
              {item.result ? (
                <>
                  <AhButton onClick={() => open(item.result!, false)}>打开原任务</AhButton>
                  {item.result.sessionId ? (
                    <AhButton variant="default" onClick={() => open(item.result!, true)}>
                      打开原工作区
                    </AhButton>
                  ) : null}
                </>
              ) : null}
              {confirm === item.key ? (
                <>
                  <AhButton
                    variant="subtle"
                    onClick={() => {
                      recovery.remove(item.key);
                      setConfirm(undefined);
                    }}
                  >
                    已核对，移除此本机记录
                  </AhButton>
                  <AhButton variant="default" onClick={() => setConfirm(undefined)}>
                    保留记录
                  </AhButton>
                </>
              ) : (
                <AhButton variant="subtle" onClick={() => setConfirm(item.key)}>
                  移除此本机恢复记录
                </AhButton>
              )}
            </div>
          </div>
        ))}
        <div className={layout.actions}>
          <AhButton variant="default" onClick={recovery.refresh} disabled={recovery.loading}>
            再次查询创建结果
          </AhButton>
        </div>
      </div>
    </section>
  );
}
