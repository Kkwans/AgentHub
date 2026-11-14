export type SavedMessageTarget = { sessionId: string; id: string; sequence: number };
export type MessageSearchHit = SavedMessageTarget & {
  role: 'USER' | 'ASSISTANT';
  createdAt: string;
  snippet: string;
};
export type MessageSearchPage = {
  hits: MessageSearchHit[];
  upperSequence: number;
  nextBeforeSequence: number | null;
  scannedCount: number;
  exhausted: boolean;
};
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
export function parseMessageSearchPage(
  value: unknown,
  sessionId: string,
  upper?: number,
  before?: number,
): MessageSearchPage {
  const page = value as MessageSearchPage | null;
  if (
    !page ||
    !Array.isArray(page.hits) ||
    page.hits.length > 20 ||
    !integer(page.upperSequence) ||
    (upper !== undefined && page.upperSequence !== upper) ||
    !integer(page.scannedCount) ||
    page.scannedCount > 100 ||
    page.scannedCount < page.hits.length ||
    (!page.exhausted && page.scannedCount === 0) ||
    typeof page.exhausted !== 'boolean' ||
    (page.exhausted
      ? page.nextBeforeSequence !== null
      : !integer(page.nextBeforeSequence) ||
        page.nextBeforeSequence < 1 ||
        page.nextBeforeSequence > page.upperSequence ||
        (before !== undefined && page.nextBeforeSequence >= before))
  )
    throw new Error('搜索分页响应无法确认，请重新搜索。');
  const seen = new Set<string>();
  let previous = before ?? Infinity;
  const hits = page.hits.map((hit) => {
    if (
      !hit ||
      typeof hit.id !== 'string' ||
      !hit.id ||
      seen.has(hit.id) ||
      hit.sessionId !== sessionId ||
      !integer(hit.sequence) ||
      hit.sequence < 1 ||
      hit.sequence > page.upperSequence ||
      hit.sequence >= previous ||
      !['USER', 'ASSISTANT'].includes(hit.role) ||
      typeof hit.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(hit.createdAt)) ||
      typeof hit.snippet !== 'string' ||
      Array.from(hit.snippet).length > 400
    )
      throw new Error('搜索结果身份或内容无法确认。');
    seen.add(hit.id);
    previous = hit.sequence;
    return {
      id: hit.id,
      sessionId,
      sequence: hit.sequence,
      role: hit.role,
      createdAt: hit.createdAt,
      snippet: hit.snippet,
    };
  });
  if (
    hits.length &&
    page.nextBeforeSequence !== null &&
    page.nextBeforeSequence > hits.at(-1)!.sequence
  )
    throw new Error('搜索游标越过已返回结果，无法继续。');
  return {
    hits,
    upperSequence: page.upperSequence,
    nextBeforeSequence: page.nextBeforeSequence,
    scannedCount: page.scannedCount,
    exhausted: page.exhausted,
  };
}
