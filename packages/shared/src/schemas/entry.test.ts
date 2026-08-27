import {describe, expect, it} from 'bun:test';
import {
  EntryEditInputSchema,
  EntryInputSchema,
  EntrySchema,
  MypageEntryDetailSchema,
  StaffEntryDetailSchema,
} from './entry';

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

  it('reports every field failure in Japanese', () => {
    const result = EntryInputSchema.safeParse({
      name: '',
      furigana: '',
      displayName: '',
      email: 'taro@localhost',
      password: 'short',
      passwordConfirm: 'short',
      regulationId: 'not-a-uuid',
      customFieldValues: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toEqual({
        name: ['氏名を入力してください'],
        furigana: ['ふりがなを入力してください'],
        displayName: ['掲載名を入力してください'],
        email: ['メールアドレスの形式が正しくありません'],
        password: ['パスワードは8文字以上で入力してください'],
        passwordConfirm: ['パスワードは8文字以上で入力してください'],
        regulationId: ['レギュレーションを選択してください'],
      });
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

describe('EntryEditInputSchema', () => {
  const BASE_EDIT = {
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    customFieldValues: {t_shirt_size: 'M'},
  };

  it('accepts the editable fields without any credentials', () => {
    const result = EntryEditInputSchema.safeParse(BASE_EDIT);

    expect(result.success).toBe(true);
  });

  it('strips email, password and regulationId, which are not editable here', () => {
    const result = EntryEditInputSchema.safeParse({
      ...BASE_EDIT,
      email: 'taro@example.com',
      password: 'password1',
      passwordConfirm: 'password1',
      regulationId: '00000000-0000-0000-0000-000000000000',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(BASE_EDIT);
    }
  });

  it('rejects an empty display name', () => {
    const result = EntryEditInputSchema.safeParse({
      ...BASE_EDIT,
      displayName: '',
    });

    expect(result.success).toBe(false);
  });
});

describe('MypageEntryDetailSchema', () => {
  const BASE_DETAIL = {
    id: '00000000-0000-0000-0000-000000000000',
    tournamentId: '00000000-0000-0000-0000-000000000001',
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    regulationLabel: '一般の部',
    freeText: null,
    customFieldValues: {},
    status: 'confirmed' as const,
    waitlistPosition: null,
    tournament: {
      name: 'テスト大会',
      type: 'saikyoi' as const,
      regionId: '00000000-0000-0000-0000-000000000002',
      entryOpensAt: '2026-01-01T00:00:00+00:00',
      entryClosesAt: '2026-02-01T00:00:00+00:00',
    },
    formFieldDefs: [],
  };

  it('accepts a detail carrying the tournament entry period', () => {
    const result = MypageEntryDetailSchema.safeParse(BASE_DETAIL);

    expect(result.success).toBe(true);
  });

  it('rejects a tournament missing its entry period', () => {
    const result = MypageEntryDetailSchema.safeParse({
      ...BASE_DETAIL,
      tournament: {
        name: 'テスト大会',
        type: 'saikyoi',
        regionId: '00000000-0000-0000-0000-000000000002',
      },
    });

    expect(result.success).toBe(false);
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
          required: true,
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
