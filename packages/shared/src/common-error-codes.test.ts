import {describe, expect, it} from 'bun:test';
import {COMMON_ERROR_CODES} from './common-error-codes';
import {ENTRY_ERROR_CODES} from './entry-error-codes';

describe('COMMON_ERROR_CODES', () => {
  // The values are the wire format, matched by clients on an old tab.
  it('keeps its wire values', () => {
    expect(COMMON_ERROR_CODES).toEqual({
      UNAUTHORIZED: 'unauthorized',
      ENTRY_NOT_FOUND: 'entry not found',
      INVALID_OR_EXPIRED_TOKEN: 'invalid or expired token',
      INVALID_REQUEST: 'invalid request',
      NOT_FOUND: 'not found',
    });
  });

  // The entry form keys its wording on `ENTRY_ERROR_CODES` alone.
  it('shares no value with ENTRY_ERROR_CODES', () => {
    const entryCodes: string[] = Object.values(ENTRY_ERROR_CODES);
    for (const code of Object.values(COMMON_ERROR_CODES)) {
      expect(entryCodes).not.toContain(code);
    }
  });
});
