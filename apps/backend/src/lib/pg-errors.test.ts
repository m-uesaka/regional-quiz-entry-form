import {afterEach, beforeEach, describe, expect, it, spyOn} from 'bun:test';
import {
  duplicate,
  FOREIGN_KEY_VIOLATION_SQLSTATE,
  mapPgError,
  missingReference,
  NO_ROW_PGRST_CODE,
  noRow,
  stillReferenced,
  UNIQUE_VIOLATION_SQLSTATE,
} from './pg-errors';

describe('the answers for each kind of violation', () => {
  it('answers a unique violation with 409', () => {
    expect(duplicate('taken')).toEqual({status: 409, error: 'taken'});
  });

  it('answers a missing referenced row with 400', () => {
    expect(missingReference('no such region')).toEqual({
      status: 400,
      error: 'no such region',
    });
  });

  it('answers a row still referenced with 409', () => {
    expect(stillReferenced('in use')).toEqual({status: 409, error: 'in use'});
  });

  it('answers a `.single()` that matched nothing with 404', () => {
    expect(noRow('not found')).toEqual({status: 404, error: 'not found'});
  });
});

describe('mapPgError', () => {
  let consoleError: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const table = {
    [UNIQUE_VIOLATION_SQLSTATE]: duplicate('slug already in use'),
    [FOREIGN_KEY_VIOLATION_SQLSTATE]: missingReference('unknown region'),
    [NO_ROW_PGRST_CODE]: noRow('region not found'),
  };

  it('answers a code the table names with its entry, without logging', () => {
    expect(
      mapPgError(
        {code: UNIQUE_VIOLATION_SQLSTATE},
        table,
        'failed to create the region',
      ),
    ).toEqual({body: {error: 'slug already in use'}, status: 409});
    expect(
      mapPgError({code: NO_ROW_PGRST_CODE}, table, 'failed to update'),
    ).toEqual({body: {error: 'region not found'}, status: 404});
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('answers any other code with a logged generic 500', () => {
    const error = {code: '23514', message: 'violates check constraint "x"'};

    expect(mapPgError(error, table, 'failed to create the region')).toEqual({
      body: {error: 'internal server error'},
      status: 500,
    });
    expect(consoleError).toHaveBeenCalledWith(
      'failed to create the region',
      error,
    );
  });

  it('answers an error without a code with a generic 500', () => {
    expect(mapPgError({}, table, 'failed').status).toBe(500);
  });

  it('does not read codes off the prototype', () => {
    expect(mapPgError({code: 'toString'}, table, 'failed').status).toBe(500);
  });
});
