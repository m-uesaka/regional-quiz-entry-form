import {describe, expect, it} from 'bun:test';
import {EntryInputSchema} from './entry';

describe('EntryInputSchema', () => {
  it('rejects mismatched password confirmation', () => {
    const result = EntryInputSchema.safeParse({
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
      displayName: '太郎',
      email: 'taro@example.com',
      password: 'password1',
      passwordConfirm: 'password2',
      regulationId: '00000000-0000-0000-0000-000000000000',
      customFieldValues: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['passwordConfirm']);
    }
  });

  it('accepts a valid payload', () => {
    const result = EntryInputSchema.safeParse({
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
      displayName: '太郎',
      email: 'taro@example.com',
      password: 'password1',
      passwordConfirm: 'password1',
      regulationId: '00000000-0000-0000-0000-000000000000',
      customFieldValues: {},
    });

    expect(result.success).toBe(true);
  });
});
