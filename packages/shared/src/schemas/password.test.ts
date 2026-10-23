import {describe, expect, it} from 'bun:test';
import {PasswordSchema} from './password';

/** The messages `PasswordSchema` reports for `value`, or none if it passes. */
function messages(value: string): string[] {
  const result = PasswordSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map(issue => issue.message);
}

describe('PasswordSchema', () => {
  it('accepts an uncommon password of reasonable length', () => {
    expect(messages('violet-harbor-lantern')).toEqual([]);
  });

  it('PasswordSchema rejects a common password', () => {
    expect(messages('password123')).toEqual([
      'よく使われているパスワードのため使用できません。別のパスワードを入力してください',
    ]);
  });

  it('rejects a common password whatever its case', () => {
    expect(messages('PassWord123')).toHaveLength(1);
    expect(messages('QWERTYUIOP')).toHaveLength(1);
  });

  it('rejects a password shorter than eight characters', () => {
    expect(messages('a1b2c3d')).toEqual([
      'パスワードは8文字以上で入力してください',
    ]);
  });

  it('accepts a password of exactly the maximum length', () => {
    expect(messages('x'.repeat(256))).toEqual([]);
  });

  it('PasswordSchema rejects a password over the maximum length', () => {
    expect(messages('x'.repeat(257))).toEqual([
      'パスワードは256文字以内で入力してください',
    ]);
  });
});
