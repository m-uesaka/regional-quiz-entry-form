import {describe, expect, it} from 'bun:test';
import {ENTRY_ERROR_CODES, isEntryErrorCode} from './entry-error-codes';

describe('ENTRY_ERROR_CODES', () => {
  // Pinned rather than derived: these are the wire format, and an entry form
  // left open on an old build still matches on them.
  it('keeps the wire values', () => {
    expect(ENTRY_ERROR_CODES).toEqual({
      INVALID_TOURNAMENT: 'invalid tournament',
      ENTRY_PERIOD_CLOSED: 'entry period closed',
      ENTRIES_PAUSED: 'entries paused',
      REGULATION_NOT_ELIGIBLE: 'regulation not eligible in priority window',
      REGULATION_NO_LONGER_AVAILABLE: 'regulation no longer available',
      ALREADY_ENTERED_ANOTHER_TOURNAMENT:
        'already entered another tournament in this region',
      INVALID_PASSWORD: 'invalid password',
      ALREADY_REGISTERED_IN_ANOTHER_REGION:
        'already registered in another region',
      ALREADY_ENTERED: 'already entered',
      ENTRY_PENDING_VERIFICATION: 'entry pending verification',
      COMMON_PASSWORD: 'password too common',
      SUPERSEDED_BY_LATER_SUBMISSION: 'superseded by a later submission',
      CONCURRENT_SUBMISSION: 'concurrent submission',
      TURNSTILE_VERIFICATION_FAILED: 'turnstile verification failed',
      TOO_MANY_REQUESTS: 'too many requests',
    });
  });
});

describe('isEntryErrorCode', () => {
  it('accepts every code', () => {
    for (const code of Object.values(ENTRY_ERROR_CODES)) {
      expect(isEntryErrorCode(code)).toBe(true);
    }
  });

  it('refuses anything else, an inherited property name included', () => {
    expect(isEntryErrorCode('something new')).toBe(false);
    expect(isEntryErrorCode('')).toBe(false);
    expect(isEntryErrorCode('constructor')).toBe(false);
  });
});
