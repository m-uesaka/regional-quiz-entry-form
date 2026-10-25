import {describe, expect, it} from 'bun:test';
import {
  CUSTOM_FIELD_VALUE_MAX_LENGTH,
  CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH,
} from '../logic/custom-field-values';
import {
  ENTRY_FREE_TEXT_MAX_LENGTH,
  ENTRY_NAME_MAX_LENGTH,
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
      password: 'quiz-pass-one',
      passwordConfirm: 'quiz-pass-two',
      regulationIds: ['00000000-0000-0000-0000-000000000000'],
      customFieldValues: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['passwordConfirm']);
    }
  });

  // #133: an entry under `Taro@Example.com` must find the participant who
  // registered as `taro@example.com`, not create a second one.
  it('lowercases the address', () => {
    const parsed = EntryInputSchema.parse({
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
      displayName: '太郎',
      email: 'Taro@Example.com',
      password: 'quiz-pass-one',
      passwordConfirm: 'quiz-pass-one',
      regulationIds: ['00000000-0000-0000-0000-000000000000'],
      customFieldValues: {},
    });

    expect(parsed.email).toBe('taro@example.com');
  });

  it('reports every field failure in Japanese', () => {
    const result = EntryInputSchema.safeParse({
      name: '',
      furigana: '',
      displayName: '',
      email: 'taro@localhost',
      password: 'short',
      passwordConfirm: 'short',
      regulationIds: [],
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
        regulationIds: ['レギュレーションを選択してください'],
      });
    }
  });

  it('accepts a valid payload', () => {
    const result = EntryInputSchema.safeParse({
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
      displayName: '太郎',
      email: 'taro@example.com',
      password: 'quiz-pass-one',
      passwordConfirm: 'quiz-pass-one',
      regulationIds: ['00000000-0000-0000-0000-000000000000'],
      customFieldValues: {},
    });

    expect(result.success).toBe(true);
  });
});

describe('EntryInputSchema length limits', () => {
  const VALID_ENTRY = {
    name: '山田太郎',
    furigana: 'やまだたろう',
    displayName: '太郎',
    email: 'taro@example.com',
    password: 'quiz-pass-one',
    passwordConfirm: 'quiz-pass-one',
    regulationIds: ['00000000-0000-0000-0000-000000000000'],
    customFieldValues: {},
  };

  it('accepts a name at the maximum length', () => {
    const result = EntryInputSchema.safeParse({
      ...VALID_ENTRY,
      name: 'あ'.repeat(ENTRY_NAME_MAX_LENGTH),
    });

    expect(result.success).toBe(true);
  });

  it('rejects a name over the maximum length', () => {
    const result = EntryInputSchema.safeParse({
      ...VALID_ENTRY,
      name: 'あ'.repeat(ENTRY_NAME_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toEqual({
        name: [`氏名は${ENTRY_NAME_MAX_LENGTH}文字以内で入力してください`],
      });
    }
  });

  it('rejects a furigana and display name over the maximum length', () => {
    const result = EntryInputSchema.safeParse({
      ...VALID_ENTRY,
      furigana: 'あ'.repeat(ENTRY_NAME_MAX_LENGTH + 1),
      displayName: 'あ'.repeat(ENTRY_NAME_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.error.flatten().fieldErrors)).toEqual([
        'furigana',
        'displayName',
      ]);
    }
  });

  it('rejects free text over the maximum length', () => {
    const result = EntryInputSchema.safeParse({
      ...VALID_ENTRY,
      freeText: 'あ'.repeat(ENTRY_FREE_TEXT_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toEqual({
        freeText: [
          `自由記述は${ENTRY_FREE_TEXT_MAX_LENGTH}文字以内で入力してください`,
        ],
      });
    }
  });

  it('rejects a custom field answer over the per-answer maximum', () => {
    const result = EntryInputSchema.safeParse({
      ...VALID_ENTRY,
      customFieldValues: {
        note: 'あ'.repeat(CUSTOM_FIELD_VALUE_MAX_LENGTH + 1),
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects custom field answers over the combined maximum', () => {
    // Every answer is within the per-answer bound; only their sum is not.
    const count =
      Math.floor(
        CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH / CUSTOM_FIELD_VALUE_MAX_LENGTH,
      ) + 1;
    const customFieldValues = Object.fromEntries(
      Array.from({length: count}, (_, i) => [
        `note_${i}`,
        'あ'.repeat(CUSTOM_FIELD_VALUE_MAX_LENGTH),
      ]),
    );

    const result = EntryInputSchema.safeParse({
      ...VALID_ENTRY,
      customFieldValues,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.customFieldValues).toEqual([
        `追加項目の回答は合計${CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH}文字以内で入力してください`,
      ]);
    }
  });

  it('rejects a checkbox answer that repeats an option past the combined maximum', () => {
    const result = EntryInputSchema.safeParse({
      ...VALID_ENTRY,
      customFieldValues: {
        allergies: Array.from(
          {length: CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH + 1},
          () => '卵',
        ),
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('EntryInputSchema password', () => {
  // The same field is how a returning participant proves an existing
  // password, which may predate the common-password rule; the backend
  // applies that rule only to a new address.
  it('accepts a common password', () => {
    const result = EntryInputSchema.safeParse({
      name: '山田太郎',
      furigana: 'やまだたろう',
      displayName: '太郎',
      email: 'taro@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
      regulationIds: ['00000000-0000-0000-0000-000000000000'],
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

  it('strips email, password and regulationIds, which are not editable here', () => {
    const result = EntryEditInputSchema.safeParse({
      ...BASE_EDIT,
      email: 'taro@example.com',
      password: 'quiz-pass-one',
      passwordConfirm: 'quiz-pass-one',
      regulationIds: ['00000000-0000-0000-0000-000000000000'],
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

  it('applies the same length limits as the entry form', () => {
    const result = EntryEditInputSchema.safeParse({
      ...BASE_EDIT,
      displayName: 'あ'.repeat(ENTRY_NAME_MAX_LENGTH + 1),
      freeText: 'あ'.repeat(ENTRY_FREE_TEXT_MAX_LENGTH + 1),
      customFieldValues: {
        note: 'あ'.repeat(CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH + 1),
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.error.flatten().fieldErrors)).toEqual([
        'displayName',
        'freeText',
        'customFieldValues',
      ]);
    }
  });
});

describe('MypageEntryDetailSchema', () => {
  const BASE_DETAIL = {
    id: '00000000-0000-0000-0000-000000000000',
    tournamentId: '00000000-0000-0000-0000-000000000001',
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    regulationLabels: ['一般の部'],
    freeText: null,
    customFieldValues: {},
    status: 'confirmed' as const,
    waitlistPosition: null,
    tournament: {
      name: 'テスト大会',
      type: 'saikyoi' as const,
      regionId: '00000000-0000-0000-0000-000000000002',
      regionSlug: 'tokyo',
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
    regulationIds: ['00000000-0000-0000-0000-000000000002'],
    regulationLabels: ['一般の部'],
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
    regulationIds: ['00000000-0000-0000-0000-000000000002'],
    regulationLabels: ['一般の部'],
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
