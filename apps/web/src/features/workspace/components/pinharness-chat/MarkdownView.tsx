/**
 * Small compatibility surface for the copied PinHarness chat primitives.
 * AgentHub already owns the Markdown pipeline; keeping this adapter means the
 * copied JSX and its layout classes remain unchanged instead of introducing a
 * second markdown renderer.
 */
import MarkdownMessage from '../MarkdownMessage';
import { StreamingDots } from './StreamingDots';

export function MarkdownView({ text }: { text: string }) {
  return <MarkdownMessage text={text} />;
}

export function MarkdownText({
  text,
  streaming: _streaming,
  truncated: _truncated,
}: {
  text: string;
  streaming?: boolean;
  truncated?: boolean;
}) {
  return (
    <div className={_streaming ? 'streaming-active-block motion-reduce:animate-none' : undefined}>
      <MarkdownMessage text={text} />
      {_streaming && text && (
        <span
          className="streaming-type-caret ml-1 inline-block"
          aria-label="正在接收 Agent 回复"
          role="status"
        >
          ▍
        </span>
      )}
      {_streaming && !text && <StreamingDots variant="primary" />}
    </div>
  );
}
