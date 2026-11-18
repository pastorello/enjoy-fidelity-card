import { fetchAllPages, type PageFetcher } from './fetchAllPages';

type Row = { id: string; createdAt: string };
type Cursor = { afterCreatedAt: string; afterId: string };

/** Fake rows whose timestamps keep the server's microseconds, which a `Date` would lose. */
function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    createdAt: `2026-07-01T10:05:00.${String(index % 1_000_000).padStart(6, '0')}+00:00`,
  }));
}

const cursorOf = (row: Row): Cursor => ({ afterCreatedAt: row.createdAt, afterId: row.id });

/** A server that answers keyset pages from `all`, recording every call it receives. */
function serverOf(all: Row[]) {
  const calls: { cursor: Cursor | null; limit: number }[] = [];
  const fetchPage: PageFetcher<Row, Cursor> = (cursor, limit) => {
    calls.push({ cursor, limit });
    const start = cursor === null ? 0 : all.findIndex((row) => row.id === cursor.afterId) + 1;
    return Promise.resolve(all.slice(start, start + limit));
  };
  return { calls, fetchPage };
}

describe('fetchAllPages', () => {
  it('returns no rows after one call when the first page is empty', async () => {
    const server = serverOf([]);

    await expect(fetchAllPages(server.fetchPage, cursorOf)).resolves.toEqual([]);
    expect(server.calls).toEqual([{ cursor: null, limit: 1000 }]);
  });

  it('asks for a second page after a full one, and stops when it is empty (1000 rows)', async () => {
    const all = rows(1000);
    const server = serverOf(all);

    const result = await fetchAllPages(server.fetchPage, cursorOf);

    expect(result).toEqual(all);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]).toEqual({ cursor: cursorOf(all[999]!), limit: 1000 });
  });

  it('returns all 1001 rows in order from two pages (criterion 7)', async () => {
    const all = rows(1001);
    const server = serverOf(all);

    const result = await fetchAllPages(server.fetchPage, cursorOf);

    expect(result).toHaveLength(1001);
    expect(result).toEqual(all);
    expect(server.calls.map((call) => call.cursor)).toEqual([null, cursorOf(all[999]!)]);
  });

  it('passes the cursor strings exactly as received, microseconds included', async () => {
    const first = { id: 'a', createdAt: '2026-07-01T10:05:00.123456+00:00' };
    const page2Cursors: (Cursor | null)[] = [];
    const fetchPage: PageFetcher<Row, Cursor> = (cursor) => {
      page2Cursors.push(cursor);
      return Promise.resolve(cursor === null ? [first] : []);
    };

    await fetchAllPages(fetchPage, cursorOf, 1);

    expect(page2Cursors[1]).toEqual({
      afterCreatedAt: '2026-07-01T10:05:00.123456+00:00',
      afterId: 'a',
    });
  });

  it('uses the given page size for every request', async () => {
    const all = rows(5);
    const server = serverOf(all);

    await expect(fetchAllPages(server.fetchPage, cursorOf, 2)).resolves.toEqual(all);
    expect(server.calls.map((call) => call.limit)).toEqual([2, 2, 2]);
  });

  it('rejects with the error of the second page and returns no partial rows', async () => {
    const all = rows(1001);
    const failure = new TypeError('Failed to fetch');
    let call = 0;
    const fetchPage: PageFetcher<Row, Cursor> = () => {
      call += 1;
      return call === 1 ? Promise.resolve(all.slice(0, 1000)) : Promise.reject(failure);
    };

    await expect(fetchAllPages(fetchPage, cursorOf)).rejects.toBe(failure);
    expect(call).toBe(2);
  });

  it.each([0, -1, 1001, 1.5, Number.NaN])(
    'refuses page size %s with a RangeError',
    async (limit) => {
      const server = serverOf(rows(3));

      await expect(fetchAllPages(server.fetchPage, cursorOf, limit)).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(server.calls).toEqual([]);
    },
  );
});
