import {describe, expect, it} from 'bun:test';
import {PAGE_SIZE_MAX} from '@regional-quiz/shared';
import {SELECT_PAGE_SIZE, fetchAllRows, fetchPage} from './paged-select';

/**
 * A `selectPage` stub serving `rows` for whatever range is requested.
 * @param rows Every row the query would match.
 */
function pageOver(rows: number[]) {
  const ranges: Array<{from: number; to: number}> = [];
  const selectPage = (from: number, to: number) => {
    ranges.push({from, to});
    return Promise.resolve({data: rows.slice(from, to + 1), error: null});
  };
  return {ranges, selectPage};
}

describe('fetchAllRows', () => {
  it('issues exactly one query for a result smaller than the page size', async () => {
    const {ranges, selectPage} = pageOver([1, 2, 3]);

    const {rows, error} = await fetchAllRows(selectPage);

    expect(error).toBeNull();
    expect(rows).toEqual([1, 2, 3]);
    expect(ranges).toEqual([{from: 0, to: SELECT_PAGE_SIZE - 1}]);
  });

  it('stops on a short page', async () => {
    const all = Array.from({length: 7}, (_, index) => index);
    const {ranges, selectPage} = pageOver(all);

    const {rows} = await fetchAllRows(selectPage, 3);

    expect(rows).toEqual(all);
    // Two full pages, then the short one that ends the paging -- no
    // further request for an empty page.
    expect(ranges).toEqual([
      {from: 0, to: 2},
      {from: 3, to: 5},
      {from: 6, to: 8},
    ]);
  });

  it('returns an empty result without a second request', async () => {
    const {ranges, selectPage} = pageOver([]);

    const {rows, error} = await fetchAllRows(selectPage);

    expect(error).toBeNull();
    expect(rows).toEqual([]);
    expect(ranges).toHaveLength(1);
  });

  it('asks for the empty page after an exactly full last page', async () => {
    // A full page cannot tell that it was the last one, so the paging only
    // ends with the empty page after it.
    const all = Array.from({length: 6}, (_, index) => index);
    const {ranges, selectPage} = pageOver(all);

    const {rows} = await fetchAllRows(selectPage, 3);

    expect(rows).toEqual(all);
    expect(ranges.map(range => range.from)).toEqual([0, 3, 6]);
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

  it('rejects a page size that would not produce a valid range', async () => {
    for (const pageSize of [0, -1, 1.5, Number.NaN]) {
      const {ranges, selectPage} = pageOver([1, 2, 3]);

      await expect(fetchAllRows(selectPage, pageSize)).rejects.toThrow(
        RangeError,
      );
      expect(ranges).toEqual([]);
    }
  });

  it('treats a null page as the end of the rows', async () => {
    const selectPage = () =>
      Promise.resolve({data: null as number[] | null, error: null});

    const {rows, error} = await fetchAllRows(selectPage);

    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });
});

describe('SELECT_PAGE_SIZE', () => {
  it('SELECT_PAGE_SIZE stays below the max_rows configured in supabase/config.toml', async () => {
    // `fetchAllRows()` ends on the first short page, which is only safe
    // while the Data API can never trim a page: lowering `max_rows` to or
    // below the page size would make every list silently drop rows.
    const configToml = await Bun.file(
      new URL('../../../../supabase/config.toml', import.meta.url),
    ).text();
    const parsed = Bun.TOML.parse(configToml) as {api: {max_rows: number}};

    expect(typeof parsed.api.max_rows).toBe('number');
    expect(SELECT_PAGE_SIZE).toBeLessThan(parsed.api.max_rows);
    // A single list page is one request, so it may not ask for more than
    // `fetchAllRows()` does per batch either.
    expect(PAGE_SIZE_MAX).toBeLessThanOrEqual(SELECT_PAGE_SIZE);
  });
});

describe('fetchPage', () => {
  /**
   * A `selectPage` stub answering like an exact-count PostgREST query over
   * `rows`, including its 416 for an offset past the last row.
   * @param rows Every row the query would match.
   */
  function countedPageOver(rows: number[]) {
    const ranges: Array<{from: number; to: number}> = [];
    const selectPage = (from: number, to: number) => {
      ranges.push({from, to});
      if (from > 0 && from >= rows.length) {
        return Promise.resolve({
          data: null,
          count: null,
          error: {message: 'Requested range not satisfiable', code: 'PGRST103'},
        });
      }
      return Promise.resolve({
        data: rows.slice(from, to + 1),
        count: rows.length,
        error: null,
      });
    };
    return {ranges, selectPage};
  }

  it('returns the requested page and the total in one request', async () => {
    const {ranges, selectPage} = countedPageOver([0, 1, 2, 3, 4]);

    const result = await fetchPage(selectPage, {limit: 2, offset: 2});

    expect(result).toEqual({rows: [2, 3], total: 5, error: null});
    expect(ranges).toEqual([{from: 2, to: 3}]);
  });

  it('answers an offset past the last row with an empty page and the total', async () => {
    const {selectPage} = countedPageOver([0, 1, 2]);

    const result = await fetchPage(selectPage, {limit: 2, offset: 10});

    expect(result).toEqual({rows: [], total: 3, error: null});
  });

  it('reports any other error', async () => {
    const selectPage = () =>
      Promise.resolve({
        data: null as number[] | null,
        count: null,
        error: {message: 'boom'},
      });

    const result = await fetchPage(selectPage, {limit: 2, offset: 0});

    expect(result).toEqual({rows: null, total: null, error: {message: 'boom'}});
  });
});
