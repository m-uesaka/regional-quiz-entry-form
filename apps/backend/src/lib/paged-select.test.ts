import {describe, expect, it} from 'bun:test';
import {SELECT_PAGE_SIZE, fetchAllRows} from './paged-select';

/**
 * A `selectPage` stub serving `rows` the way the Data API does: never more
 * than `serverCap` rows at a time, regardless of the requested range.
 * @param rows Every row the query would match.
 * @param serverCap The server's own `max_rows` equivalent.
 */
function pageOver(rows: number[], serverCap = Number.POSITIVE_INFINITY) {
  const ranges: Array<{from: number; to: number}> = [];
  const selectPage = (from: number, to: number) => {
    ranges.push({from, to});
    const end = Math.min(to + 1, from + serverCap);
    return Promise.resolve({data: rows.slice(from, end), error: null});
  };
  return {ranges, selectPage};
}

describe('fetchAllRows', () => {
  it('returns every row when a single page covers them all', async () => {
    const {ranges, selectPage} = pageOver([1, 2, 3]);

    const {rows, error} = await fetchAllRows(selectPage);

    expect(error).toBeNull();
    expect(rows).toEqual([1, 2, 3]);
    // The full first page plus the empty one that ends the paging.
    expect(ranges).toEqual([
      {from: 0, to: SELECT_PAGE_SIZE - 1},
      {from: 3, to: 3 + SELECT_PAGE_SIZE - 1},
    ]);
  });

  it('returns an empty result without a second request', async () => {
    const {ranges, selectPage} = pageOver([]);

    const {rows, error} = await fetchAllRows(selectPage);

    expect(error).toBeNull();
    expect(rows).toEqual([]);
    expect(ranges).toHaveLength(1);
  });

  it('pages until a request comes back empty', async () => {
    const all = Array.from({length: 7}, (_, index) => index);
    const {ranges, selectPage} = pageOver(all);

    const {rows} = await fetchAllRows(selectPage, 3);

    expect(rows).toEqual(all);
    expect(ranges).toEqual([
      {from: 0, to: 2},
      {from: 3, to: 5},
      {from: 6, to: 8},
      {from: 7, to: 9},
    ]);
  });

  it('keeps paging when the server trims a page below the requested size', async () => {
    // A deployment whose `max_rows` is under the requested page size trims
    // every response, so a short batch does not mean the rows ran out.
    const all = Array.from({length: 5}, (_, index) => index);
    const {ranges, selectPage} = pageOver(all, 2);

    const {rows} = await fetchAllRows(selectPage, 10);

    expect(rows).toEqual(all);
    expect(ranges.map(range => range.from)).toEqual([0, 2, 4, 5]);
  });

  it('gives up on the first error and reports it', async () => {
    let calls = 0;
    const selectPage = (from: number) => {
      calls++;
      return from === 0
        ? Promise.resolve({data: [1, 2], error: null})
        : Promise.resolve({data: null, error: {message: 'boom'}});
    };

    const {rows, error} = await fetchAllRows(selectPage, 2);

    expect(rows).toBeNull();
    expect(error).toEqual({message: 'boom'});
    expect(calls).toBe(2);
  });

  it('treats a null page as the end of the rows', async () => {
    const selectPage = () =>
      Promise.resolve({data: null as number[] | null, error: null});

    const {rows, error} = await fetchAllRows(selectPage);

    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });
});
