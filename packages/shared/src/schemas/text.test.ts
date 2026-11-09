import {describe, expect, it} from 'bun:test';
import {
  CUSTOM_FIELD_VALUE_MAX_LENGTH,
  customFieldValuesLength,
} from '../logic/custom-field-values';
import {
  ENTRY_FREE_TEXT_MAX_LENGTH,
  ENTRY_NAME_MAX_LENGTH,
  EntryEditInputSchema,
  EntryInputSchema,
} from './entry';
import {parseFormDefinitionYaml} from './form-definition';
import {
  STAFF_MAIL_BODY_MAX_LENGTH,
  STAFF_MAIL_SUBJECT_MAX_LENGTH,
  StaffMailInputSchema,
} from './mail';
import {
  REGULATION_LABEL_MAX_LENGTH,
  RegulationUpsertSchema,
} from './regulation';
import {codePointLength, isWellFormedText, maxLengthAttribute} from './text';
import {TournamentCreateInputSchema} from './tournament';

// What `"\ud800"` in a JSON body decodes to.
const LONE_HIGH = '\ud800';
const LONE_LOW = '\udc00';

describe('isWellFormedText', () => {
  it('refuses either half of a pair on its own', () => {
    expect(isWellFormedText(LONE_HIGH)).toBe(false);
    expect(isWellFormedText(`前${LONE_LOW}後`)).toBe(false);
    // The halves in the wrong order are two lone surrogates, not a pair.
    expect(isWellFormedText(LONE_LOW + LONE_HIGH)).toBe(false);
  });

  it('accepts paired surrogates: an emoji, a kanji outside the BMP', () => {
    expect(isWellFormedText('🎉𠮷')).toBe(true);
    expect(isWellFormedText('')).toBe(true);
  });
});

// Each of these is written to the database, which answered a lone surrogate
// with a 500 rather than the field error these give (#298).
describe('the schemas of what is stored', () => {
  const ENTRY = {
    name: '山田太郎',
    furigana: 'やまだたろう',
    displayName: '太郎',
    email: 'taro@example.com',
    password: 'quiz-pass-one',
    passwordConfirm: 'quiz-pass-one',
    regulationIds: ['00000000-0000-0000-0000-000000000000'],
    customFieldValues: {},
  };

  function fieldErrorsOf(result: {
    success: boolean;
    error?: {flatten(): {fieldErrors: object}};
  }) {
    expect(result.success).toBe(false);
    return result.error?.flatten().fieldErrors;
  }

  it('refuses one in the free text of an entry and of an edit', () => {
    expect(
      fieldErrorsOf(
        EntryInputSchema.safeParse({...ENTRY, freeText: `備考${LONE_HIGH}`}),
      ),
    ).toEqual({freeText: ['自由記述に使用できない文字が含まれています']});
    expect(
      EntryEditInputSchema.safeParse({
        name: '山田太郎',
        furigana: 'やまだたろう',
        displayName: '太郎',
        freeText: LONE_HIGH,
        customFieldValues: {},
      }).success,
    ).toBe(false);
  });

  it('refuses one in an answer, a list answer, or an answer key', () => {
    for (const customFieldValues of [
      {comment: LONE_HIGH},
      {colors: ['red', LONE_LOW]},
      {[LONE_HIGH]: 'x'},
    ]) {
      expect(
        EntryInputSchema.safeParse({...ENTRY, customFieldValues}).success,
      ).toBe(false);
    }
  });

  it('still accepts emoji in the free text and the answers', () => {
    expect(
      EntryInputSchema.safeParse({
        ...ENTRY,
        freeText: 'よろしく🎉',
        customFieldValues: {comment: '𠮷野家', colors: ['🍎']},
      }).success,
    ).toBe(true);
  });

  it('refuses one in a staff mail subject or body', () => {
    expect(
      fieldErrorsOf(
        StaffMailInputSchema.safeParse({subject: LONE_HIGH, body: '本文'}),
      ),
    ).toEqual({subject: ['件名に使用できない文字が含まれています']});
    expect(
      fieldErrorsOf(
        StaffMailInputSchema.safeParse({subject: '件名', body: LONE_HIGH}),
      ),
    ).toEqual({body: ['本文に使用できない文字が含まれています']});
  });

  it('refuses one in a form definition label or option', () => {
    // YAML's double-quoted escapes decode `\ud800` the way JSON does.
    for (const field of [
      'label: "規約\\ud800"\n    type: checkbox',
      'label: 座席\n    type: radio\n    options: ["前", "\\udc00"]',
    ]) {
      expect(() =>
        parseFormDefinitionYaml(
          `tournamentSlug: saikyoi\nfields:\n  - key: field\n    ${field}\n`,
        ),
      ).toThrow();
    }
  });

  it('refuses one in a regulation label or a tournament name', () => {
    expect(
      RegulationUpsertSchema.safeParse({label: `一般${LONE_HIGH}`}).success,
    ).toBe(false);
    expect(
      TournamentCreateInputSchema.safeParse({
        regionId: '11111111-1111-1111-1111-111111111111',
        type: 'saikyoi',
        capacity: null,
        entryOpensAt: '2026-01-01T00:00:00+09:00',
        entryClosesAt: '2026-01-31T00:00:00+09:00',
        name: LONE_HIGH,
      }).success,
    ).toBe(false);
  });
});

describe('codePointLength', () => {
  it('counts a character outside the BMP once, as char_length() does', () => {
    expect(codePointLength('𠮷野家')).toBe(3);
    expect('𠮷野家'.length).toBe(4);
    // A composed emoji is several code points to the database too.
    expect(codePointLength('👨‍👩‍👧')).toBe(5);
    expect(codePointLength('')).toBe(0);
  });
});

describe('maxLengthAttribute', () => {
  it('leaves room for the limit in characters outside the BMP', () => {
    const limit = 3;
    expect('🎉'.repeat(limit).length).toBe(maxLengthAttribute(limit));
  });
});

// The JS side used to count UTF-16 units and so refuse at about half the
// limit what the database's `char_length()` would take (#302).
describe('limits counted in code points', () => {
  const ENTRY = {
    name: '山田太郎',
    furigana: 'やまだたろう',
    displayName: '太郎',
    email: 'taro@example.com',
    password: 'quiz-pass-one',
    passwordConfirm: 'quiz-pass-one',
    regulationIds: ['00000000-0000-0000-0000-000000000000'],
    customFieldValues: {},
  };
  const WIDE = '🎉';

  it('takes a display name of the limit in emoji, and refuses one more', () => {
    const atLimit = WIDE.repeat(ENTRY_NAME_MAX_LENGTH);

    expect(
      EntryInputSchema.safeParse({...ENTRY, displayName: atLimit}).success,
    ).toBe(true);
    const over = EntryInputSchema.safeParse({
      ...ENTRY,
      displayName: atLimit + WIDE,
    });
    expect(over.success).toBe(false);
    expect(over.error?.flatten().fieldErrors).toEqual({
      displayName: [
        `エントリーリスト掲載名は${ENTRY_NAME_MAX_LENGTH}文字以内で入力してください`,
      ],
    });
  });

  it('counts the free text and the answers the same way', () => {
    expect(
      EntryInputSchema.safeParse({
        ...ENTRY,
        freeText: WIDE.repeat(ENTRY_FREE_TEXT_MAX_LENGTH),
        customFieldValues: {
          comment: WIDE.repeat(CUSTOM_FIELD_VALUE_MAX_LENGTH),
        },
      }).success,
    ).toBe(true);
    expect(
      EntryInputSchema.safeParse({
        ...ENTRY,
        customFieldValues: {
          comment: WIDE.repeat(CUSTOM_FIELD_VALUE_MAX_LENGTH + 1),
        },
      }).success,
    ).toBe(false);
    expect(customFieldValuesLength({a: WIDE.repeat(3), b: [WIDE, 'x']})).toBe(
      5,
    );
  });

  it('counts a regulation label and a staff mail in code points', () => {
    expect(
      RegulationUpsertSchema.safeParse({
        label: WIDE.repeat(REGULATION_LABEL_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      RegulationUpsertSchema.safeParse({
        label: WIDE.repeat(REGULATION_LABEL_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      StaffMailInputSchema.safeParse({
        subject: WIDE.repeat(STAFF_MAIL_SUBJECT_MAX_LENGTH),
        body: WIDE.repeat(STAFF_MAIL_BODY_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      StaffMailInputSchema.safeParse({
        subject: WIDE.repeat(STAFF_MAIL_SUBJECT_MAX_LENGTH + 1),
        body: '本文',
      }).success,
    ).toBe(false);
  });
});
