import { AhButton, CircleStop } from '@agenthub/ui';
import { useNavigate } from 'react-router-dom';
import type { TaskRecord } from '../../../lib/api';

export function TaskCancelAction({
  task,
  pending,
  onCancel,
}: {
  task: Pick<TaskRecord, 'status' | 'sessionId'>;
  pending: boolean;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  if (task.status === 'IN_PROGRESS') {
    return (
      <div>
        {task.sessionId ? (
          <AhButton
            size="xs"
            variant="default"
            onClick={() => navigate(`/workspace/${encodeURIComponent(task.sessionId!)}`)}
          >
            前往工作区停止执行
          </AhButton>
        ) : (
          <div>
            <AhButton size="xs" variant="default" loading={pending} onClick={onCancel}>
              核对并取消任务
            </AhButton>
            <p>尚未关联工作区；仅当服务器确认没有未决 Run 时才能取消任务。</p>
          </div>
        )}
        {task.sessionId ? (
          <p>停止请求不代表已停止；请先核对 Run 权威终态，再取消任务。完成的结果仍需审阅。</p>
        ) : null}
      </div>
    );
  }
  return (
    <AhButton
      size="xs"
      variant="default"
      loading={pending}
      disabled={task.status === 'DONE' || task.status === 'CANCELED'}
      onClick={onCancel}
    >
      <CircleStop size={14} /> 取消
    </AhButton>
  );
}
