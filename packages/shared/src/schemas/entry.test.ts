import {describe, expect, it} from 'bun:test';
import {EntryInputSchema, EntrySchema, StaffEntryDetailSchema} from './entry';

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

describe('EntrySchema', () => {
  const BASE_ENTRY = {
    id: '00000000-0000-0000-0000-000000000000',
    tournamentId: '00000000-0000-0000-0000-000000000001',
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    email: 'taro@example.com',
    regulationId: '00000000-0000-0000-0000-000000000002',
    regulationLabel: '一般の部',
    freeText: null,
    status: 'confirmed' as const,
    waitlistPosition: null,
  };

  it('accepts customFieldValues with string values', () => {
    const result = EntrySchema.safeParse({
      ...BASE_ENTRY,
      customFieldValues: {t_shirt_size: 'M'},
    });

    expect(result.success).toBe(true);
  });

  it('accepts customFieldValues with string array values', () => {
    const result = EntrySchema.safeParse({
      ...BASE_ENTRY,
      customFieldValues: {toppings: ['cheese', 'olive']},
    });

    expect(result.success).toBe(true);
  });

  it('rejects customFieldValues with a number value', () => {
    const result = EntrySchema.safeParse({
      ...BASE_ENTRY,
      customFieldValues: {age: 20},
    });

    expect(result.success).toBe(false);
  });

  it('rejects customFieldValues with a boolean value', () => {
    const result = EntrySchema.safeParse({
      ...BASE_ENTRY,
      customFieldValues: {agreed: true},
    });

    expect(result.success).toBe(false);
  });

  it('rejects customFieldValues with an object value', () => {
    const result = EntrySchema.safeParse({
      ...BASE_ENTRY,
      customFieldValues: {nested: {foo: 'bar'}},
    });

    expect(result.success).toBe(false);
  });

  it('rejects customFieldValues with a null value', () => {
    const result = EntrySchema.safeParse({
      ...BASE_ENTRY,
      customFieldValues: {optional: null},
    });

    expect(result.success).toBe(false);
  });
});

describe('StaffEntryDetailSchema', () => {
  const BASE_ENTRY = {
    id: '00000000-0000-0000-0000-000000000000',
    tournamentId: '00000000-0000-0000-0000-000000000001',
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    email: 'taro@example.com',
    regulationId: '00000000-0000-0000-0000-000000000002',
    regulationLabel: '一般の部',
    freeText: null,
    customFieldValues: {},
    status: 'confirmed' as const,
    waitlistPosition: null,
  };

  it('accepts an entry with ordered form field defs', () => {
    const result = StaffEntryDetailSchema.safeParse({
      ...BASE_ENTRY,
      formFieldDefs: [
        {
          fieldKey: 't_shirt_size',
          label: 'Tシャツサイズ',
          fieldType: 'radio',
          options: ['S', 'M', 'L'],
          displayOrder: 0,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an entry missing formFieldDefs', () => {
    const result = StaffEntryDetailSchema.safeParse(BASE_ENTRY);

    expect(result.success).toBe(false);
  });
});
