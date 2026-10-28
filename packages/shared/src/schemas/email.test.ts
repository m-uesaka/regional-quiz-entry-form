import {describe, expect, it} from 'bun:test';
import {EMAIL_MAX_LENGTH, emailAddressSchema} from './email';

describe('emailAddressSchema', () => {
  // `local@example.com` padded out to exactly `length` characters.
  function addressOfLength(length: number): string {
    const domain = '@example.com';
    return `${'a'.repeat(length - domain.length)}${domain}`;
  }

  it('accepts an address at the maximum length', () => {
    const address = addressOfLength(EMAIL_MAX_LENGTH);

    expect(emailAddressSchema().parse(address)).toBe(address);
  });

  // #193: kilobytes of address would otherwise reach the rate limit key and
  // the database.
  it('rejects an address over the maximum length', () => {
    expect(
      emailAddressSchema().safeParse(addressOfLength(EMAIL_MAX_LENGTH + 1))
        .success,
    ).toBe(false);
  });

  it('refuses an over-long address in Japanese when given a message', () => {
    const result = emailAddressSchema('形式が正しくありません').safeParse(
      addressOfLength(EMAIL_MAX_LENGTH + 1),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message)).toContain(
        `メールアドレスは${EMAIL_MAX_LENGTH}文字以内で入力してください`,
      );
    }
  });
});
