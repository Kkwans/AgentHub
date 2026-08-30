import { Wrench } from '@agenthub/ui';
import { EmptyState, ErrorState, LoadingState } from '../../../components/Common';
import type { EventRecord } from '../../../lib/api';
import { labelAgentEventType } from '../../../presentation/domain-labels';
import type { QueryState } from '../workspace-types';

export function ActivityPanel({ events }: { events: QueryState<EventRecord[]> }) {
  const toolEvents = [...(events.data ?? [])]
    .filter(
      (event) =>
        event.payloadJson.ignored !== true &&
        (event.type.startsWith('tool.') || event.type === 'agent.plan.updated'),
    )
    .reverse();
  return (
    <div className="tool-call-inspector">
      <div className="activity-summary">
        <div>
          <strong>工具调用</strong>
          <span>完整参数、结果与错误按时间倒序显示。</span>
        </div>
        <span>{toolEvents.length}</span>
      </div>
      {events.isLoading ? (
        <LoadingState label="正在读取工具调用" />
      ) : events.error ? (
        <ErrorState error={events.error} retry={() => events.refetch()} />
      ) : !toolEvents.length ? (
        <EmptyState
          title="还没有工具调用"
          description="Agent 调用工具后，详细记录会出现在这里。"
        />
      ) : (
        <div className="tool-call-list">
          {toolEvents.map((event) => (
            <details key={event.id}>
              <summary>
                <span>
                  <Wrench size={15} />
                </span>
                <div>
                  <strong>
                    {String(event.payloadJson.title ?? labelAgentEventType(event.type))}
                  </strong>
                  <small>
                    {labelAgentEventType(event.type)} · #{event.seq}
                  </small>
                </div>
                <time dateTime={event.createdAt}>{formatGitTime(event.createdAt)}</time>
              </summary>
              <pre>{JSON.stringify(event.payloadJson, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export const ToolCallsInspector = ActivityPanel;

function formatGitTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString('zh-CN', { hour12: false });
}
