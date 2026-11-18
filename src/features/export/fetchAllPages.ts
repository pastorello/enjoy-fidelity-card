// Keyset pagination for the export RPCs (SPEC-export, point 6). The server caps each page at 1000 rows
// (PostgREST `max_rows`), so the client asks for pages until one comes back shorter than the limit.
// The cursor is taken from the last row exactly as it arrives: `created_at` keeps its microseconds as
// a string and never goes through `Date`, which would round it and skip or repeat rows.

/** The largest page the export RPCs accept. */
export const EXPORT_PAGE_LIMIT = 1000;

/** Reads one page: the rows after `cursor` (from the start when null), at most `limit` of them. */
export type PageFetcher<Row, Cursor> = (cursor: Cursor | null, limit: number) => Promise<Row[]>;

/**
 * Reads every page and returns all the rows in server order, or rejects with the first error: a
 * failure on any page discards the rows already read, so a caller never writes a partial file.
 */
export async function fetchAllPages<Row, Cursor>(
  fetchPage: PageFetcher<Row, Cursor>,
  cursorOf: (row: Row) => Cursor,
  limit: number = EXPORT_PAGE_LIMIT,
): Promise<Row[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPORT_PAGE_LIMIT) {
    throw new RangeError(`page limit must be an integer from 1 to ${EXPORT_PAGE_LIMIT}: ${limit}`);
  }
  const all: Row[] = [];
  let cursor: Cursor | null = null;
  for (;;) {
    // Sequential by design: each page's cursor is the last row of the page before, so none can run in parallel.
    // oxlint-disable-next-line no-await-in-loop
    const page = await fetchPage(cursor, limit);
    all.push(...page);
    const last = page.at(-1);
    if (page.length < limit || last === undefined) return all;
    cursor = cursorOf(last);
  }
}
