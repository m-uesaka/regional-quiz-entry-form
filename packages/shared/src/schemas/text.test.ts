import {describe, expect, it} from 'bun:test';
import {EntryEditInputSchema, EntryInputSchema} from './entry';
import {parseFormDefinitionYaml} from './form-definition';
import {StaffMailInputSchema} from './mail';
import {RegulationUpsertSchema} from './regulation';
import {isWellFormedText} from './text';
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
