import {describe, expect, it} from 'vitest';
import {NO_FIELD_ERRORS} from './form-errors';
import type {FieldErrors} from './types/form-errors';

describe('NO_FIELD_ERRORS', () => {
  it('is empty', () => {
    expect(NO_FIELD_ERRORS).toEqual({});
  });

  // Every action that refuses a submission as a whole answers with this one
  // object, so a write into it would show up in every later refusal.
  it('refuses a write into it', () => {
    const shared = NO_FIELD_ERRORS as FieldErrors;

    expect(() => {
      shared['name'] = ['stale'];
    }).toThrow(TypeError);
    expect(NO_FIELD_ERRORS).toEqual({});
  });
});
