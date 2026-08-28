import {describe, expect, it} from 'vitest';
import {readTurnstileToken, TURNSTILE_TOKEN_FIELD} from './turnstile';

/** A form carrying `value` in the control the widget writes into. */
function formWith(value: string): FormData {
  const formData = new FormData();
  formData.set(TURNSTILE_TOKEN_FIELD, value);
  return formData;
}

describe('readTurnstileToken', () => {
  it("returns the widget's token unchanged", () => {
    expect(readTurnstileToken(formWith('0.abc-DEF_123.xyz'))).toBe(
      '0.abc-DEF_123.xyz',
    );
  });

  it('returns an empty string when the control is absent', () => {
    expect(readTurnstileToken(new FormData())).toBe('');
  });

  it('drops a value no HTTP header could carry', () => {
    // The action can be posted to directly, so this control holds whatever
    // the caller put in it. Forwarded as it stands, a newline makes
    // `new Request()` throw inside the action -- an unhandled 500 error
    // page, where the challenge is supposed to answer 400. Empty is what a
    // missing token looks like, and the API fails closed on that.
    expect(readTurnstileToken(formWith('token\r\nX-Injected: 1'))).toBe('');
    expect(readTurnstileToken(formWith('token\nmore'))).toBe('');
    expect(readTurnstileToken(formWith('token '))).toBe('');
    expect(readTurnstileToken(formWith('\u30c8\u30fc\u30af\u30f3'))).toBe('');
  });

  it('drops a value far longer than any token', () => {
    expect(readTurnstileToken(formWith('a'.repeat(4097)))).toBe('');
  });
});
