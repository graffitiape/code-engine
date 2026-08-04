export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

interface CollectCursorPagesOptions<T> {
  loadPage: (cursor: string | null, limit: number) => Promise<CursorPage<T>>;
  isCurrent: () => boolean;
  pageSize?: number;
  maxItems?: number;
}

/** Collect cursor-based results while an owning project request is still current. */
export async function collectCursorPages<T>({
  loadPage,
  isCurrent,
  pageSize = 100,
  maxItems = 500,
}: CollectCursorPagesOptions<T>): Promise<T[] | null> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  while (items.length < maxItems) {
    if (!isCurrent()) return null;
    const limit = Math.min(pageSize, maxItems - items.length);
    const page = await loadPage(cursor, limit);
    if (!isCurrent()) return null;
    items.push(...page.data.slice(0, limit));

    const nextCursor = page.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return items;
}
