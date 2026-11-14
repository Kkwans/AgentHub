/** Read-only export of persisted conversation text, not a full audit or live stream. */
export const TRANSCRIPT_LIMITS = {
  pageSize: 200,
  messages: 10_000,
  characters: 4_000_000,
} as const;
type Row = {
  id: string;
  sessionId: string;
  sequence: number;
  role: string;
  text: string | null;
  createdAt: string;
};
export type Transcript = { upperSequence: number; rows: Row[] };
const fail = () => new Error('文字记录读取失败或超出导出上限，未生成文件。');
function pageRows(value: unknown, id: string): Row[] {
  if (!Array.isArray(value) || value.length > TRANSCRIPT_LIMITS.pageSize) throw fail();
  return value.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw fail();
    const r = row as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      !r.id ||
      r.sessionId !== id ||
      !Number.isSafeInteger(r.sequence) ||
      Number(r.sequence) < 1 ||
      !['USER', 'ASSISTANT', 'SYSTEM', 'TOOL'].includes(String(r.role)) ||
      !(r.text === null || typeof r.text === 'string') ||
      typeof r.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(r.createdAt))
    )
      throw fail();
    return {
      id: r.id,
      sessionId: id,
      sequence: Number(r.sequence),
      role: String(r.role),
      text: r.text as string | null,
      createdAt: r.createdAt,
    };
  });
}
export async function collectTranscript(
  sessionId: string,
  read: (before: number | undefined, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<Transcript> {
  const rows = new Map<number, Row>();
  const ids = new Map<string, number>();
  let before: number | undefined;
  let upperSequence = 0;
  let characters = 0;
  for (;;) {
    signal.throwIfAborted();
    const page = pageRows(await read(before, signal), sessionId);
    signal.throwIfAborted();
    if (!page.length) break;
    if (before === undefined) upperSequence = Math.max(...page.map((row) => row.sequence));
    let next = before ?? Infinity;
    for (const row of page) {
      if (row.sequence > upperSequence) throw fail();
      const existing = rows.get(row.sequence);
      // Tolerate identical overlap, never conflicting records or a changed id/sequence.
      if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw fail();
      if (ids.has(row.id) && ids.get(row.id) !== row.sequence) throw fail();
      if (!existing) {
        if (before !== undefined && row.sequence >= before) throw fail();
        characters += row.text?.length ?? 0;
        rows.set(row.sequence, row);
        ids.set(row.id, row.sequence);
        if (rows.size > TRANSCRIPT_LIMITS.messages || characters > TRANSCRIPT_LIMITS.characters)
          throw fail();
      }
      next = Math.min(next, row.sequence);
    }
    if (before !== undefined && next >= before) throw fail();
    before = next;
  }
  return { upperSequence, rows: [...rows.values()].sort((a, b) => a.sequence - b.sequence) };
}
function plain(value: string) {
  return value.replace(
    // Strip controls/bidi direction overrides before writing a portable text file.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
    '',
  );
}
function literal(value: string) {
  const text = plain(value).replace(/\r\n?/g, '\n');
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2);
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}
export function formatTranscript(
  input: Transcript,
  session: { id: string; title: string },
  exportedAt: string,
) {
  const body = input.rows
    .filter((row) => ['USER', 'ASSISTANT'].includes(row.role) && row.text !== null)
    .map(
      (row) =>
        `## ${row.role === 'USER' ? '用户' : '助手'} · #${row.sequence} · ${new Date(row.createdAt).toISOString()}\n\n${literal(row.text ?? '')}`,
    );
  return `# AgentHub 会话文字记录\n\n格式版本：1\n\n标题：\n${literal(session.title)}\n\nSession：\n${literal(session.id)}\n\n导出时间：${exportedAt}\n\n消息序号上界：${input.upperSequence}\n\n仅含已持久化的用户和助手文字。不含实时片段、工具/思考/审批、附件或续接会话；不是完整审计或事务快照。分享前请检查敏感信息。\n\n${body.join('\n\n') || '（此范围内没有用户或助手文字。）'}\n`;
}
export function transcriptFilename(title: string) {
  return `${
    plain(title)
      .replace(/[<>:"/\\|?*\r\n]/g, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80) || 'conversation'
  }-文字记录.md`;
}
