import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import {RegionSchema} from '@regional-quiz/shared';
import {parseEntryId, parseRouteId} from './route-id';

const UUID = '00000000-0000-0000-0000-000000000001';

describe('parseRouteId', () => {
  const options = {
    schema: RegionSchema.shape.id,
    notFoundMessage: '地域が見つかりません',
  };

  it('passes an id the schema accepts through', () => {
    expect(parseRouteId(UUID, options)).toBe(UUID);
  });

  it('throws 404 with the wording it is given for an id the schema refuses', () => {
    expect(() => parseRouteId('not-a-uuid', options)).toThrow(
      expect.objectContaining({
        status: 404,
        body: {message: '地域が見つかりません'},
      } satisfies Partial<HttpError>),
    );
  });
});

describe('parseEntryId', () => {
  it('passes a UUID through', () => {
    expect(parseEntryId(UUID)).toBe(UUID);
  });

  it.each(['not-a-uuid', '', `${UUID}x`])('throws 404 for %j', entryId => {
    expect(() => parseEntryId(entryId)).toThrow(
      expect.objectContaining({
        status: 404,
        body: {message: 'エントリーが見つかりません'},
      } satisfies Partial<HttpError>),
    );
  });
});
