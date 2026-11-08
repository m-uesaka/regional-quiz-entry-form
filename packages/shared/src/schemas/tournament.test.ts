import {describe, expect, it} from 'bun:test';
import {
  defaultTournamentName,
  ENTRY_PERIOD_ORDER_MESSAGE,
  isEntryPeriodOrdered,
  TournamentCreateInputSchema,
  TournamentOrderInputSchema,
  TournamentResetInputSchema,
  TournamentUpdateInputSchema,
} from './tournament';

const CREATE_INPUT = {
  regionId: '11111111-1111-1111-1111-111111111111',
  type: 'saikyoi',
  capacity: null,
  entryOpensAt: '2026-01-01T00:00:00+09:00',
  entryClosesAt: '2026-01-31T00:00:00+09:00',
} as const;

describe('TournamentCreateInputSchema', () => {
  it('takes a missing or blank name as the empty string that asks for the default', () => {
    expect(TournamentCreateInputSchema.parse(CREATE_INPUT).name).toBe('');
    expect(
      TournamentCreateInputSchema.parse({...CREATE_INPUT, name: '  '}).name,
    ).toBe('');
  });

  it('keeps a name that was given, trimmed', () => {
    expect(
      TournamentCreateInputSchema.parse({...CREATE_INPUT, name: ' 東京大会 '})
        .name,
    ).toBe('東京大会');
  });
});

describe('isEntryPeriodOrdered', () => {
  it('holds only when the period opens strictly before it closes', () => {
    expect(
      isEntryPeriodOrdered(
        '2026-01-01T00:00:00+09:00',
        '2026-01-01T00:00:01+09:00',
      ),
    ).toBe(true);
    expect(
      isEntryPeriodOrdered(
        '2026-01-01T00:00:00+09:00',
        '2026-01-01T00:00:00+09:00',
      ),
    ).toBe(false);
    expect(
      isEntryPeriodOrdered(
        '2026-01-31T00:00:00+09:00',
        '2026-01-01T00:00:00+09:00',
      ),
    ).toBe(false);
  });

  it('compares instants, not the strings', () => {
    // The same instant written in two offsets.
    expect(
      isEntryPeriodOrdered('2026-01-01T09:00:00+09:00', '2026-01-01T00:00:00Z'),
    ).toBe(false);
  });
});

describe('TournamentCreateInputSchema entry period', () => {
  for (const entryClosesAt of [
    CREATE_INPUT.entryOpensAt,
    '2025-12-31T00:00:00+09:00',
  ]) {
    it(`refuses a period closing at ${entryClosesAt}, on entryClosesAt`, () => {
      const parsed = TournamentCreateInputSchema.safeParse({
        ...CREATE_INPUT,
        entryClosesAt,
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues).toEqual([
        expect.objectContaining({
          path: ['entryClosesAt'],
          message: ENTRY_PERIOD_ORDER_MESSAGE,
        }),
      ]);
    });
  }
});

describe('TournamentCreateInputSchema questionSet', () => {
  const parse = (questionSet: unknown) =>
    TournamentCreateInputSchema.safeParse({...CREATE_INPUT, questionSet});

  it('takes a missing, null or blank question set as the common questions', () => {
    expect(TournamentCreateInputSchema.parse(CREATE_INPUT).questionSet).toBe(
      null,
    );
    expect(parse(null).data?.questionSet).toBe(null);
    expect(parse(' 　').data?.questionSet).toBe(null);
  });

  it('folds full-width characters and trims the ends', () => {
    expect(parse('　宮崎Ａ１ ').data?.questionSet).toBe('宮崎A1');
  });

  it('refuses a space inside the name, full-width included', () => {
    expect(parse('宮 崎').success).toBe(false);
    expect(parse('宮　崎').success).toBe(false);
  });

  it('refuses a name over the length the database takes, in code points', () => {
    expect(parse('あ'.repeat(101)).success).toBe(false);
    expect(parse('あ'.repeat(100)).success).toBe(true);
    // 100 characters, 200 UTF-16 units.
    expect(parse('𠮷'.repeat(100)).success).toBe(true);
  });

  it('drops format characters a pasted name carries', () => {
    expect(parse('宮崎\u200b').data?.questionSet).toBe('宮崎');
    expect(parse('\ufeff宮\u2060崎').data?.questionSet).toBe('宮崎');
    expect(parse('\u200b').data?.questionSet).toBe(null);
  });

  it('stores half-width katakana as the full-width the database keeps', () => {
    expect(parse('ﾐﾔｻﾞｷ').data?.questionSet).toBe('ミヤザキ');
  });

  // The edit form sends the stored name back on every save.
  it('leaves a name it stored as it is', () => {
    for (const name of ['宮崎A', 'ミヤザキ', '鹿児島']) {
      expect(parse(name).data?.questionSet).toBe(name);
    }
  });
});

describe('TournamentUpdateInputSchema', () => {
  it('leaves an omitted name out, so the stored one is kept', () => {
    expect(TournamentUpdateInputSchema.parse({capacity: 10})).toEqual({
      capacity: 10,
    });
  });

  it('leaves an omitted question set out, and keeps an explicit null', () => {
    expect('questionSet' in TournamentUpdateInputSchema.parse({})).toBe(false);
    expect(
      TournamentUpdateInputSchema.parse({questionSet: null}).questionSet,
    ).toBe(null);
  });
});

describe('TournamentUpdateInputSchema entry period', () => {
  it('refuses both ends sent out of order', () => {
    const parsed = TournamentUpdateInputSchema.safeParse({
      entryOpensAt: CREATE_INPUT.entryClosesAt,
      entryClosesAt: CREATE_INPUT.entryOpensAt,
    });
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({
        path: ['entryClosesAt'],
        message: ENTRY_PERIOD_ORDER_MESSAGE,
      }),
    ]);
  });

  // Checked against the stored other end by the database instead (0048).
  it('lets one end through on its own', () => {
    expect(
      TournamentUpdateInputSchema.safeParse({
        entryClosesAt: '2000-01-01T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      TournamentUpdateInputSchema.safeParse({
        entryOpensAt: '2999-01-01T00:00:00Z',
      }).success,
    ).toBe(true);
  });
});

describe('TournamentOrderInputSchema', () => {
  const A = '00000000-0000-0000-0000-00000000000a';
  const B = '00000000-0000-0000-0000-00000000000b';

  it('accepts tournament ids in the order to show them', () => {
    expect(
      TournamentOrderInputSchema.safeParse({tournamentIds: [B, A]}).success,
    ).toBe(true);
  });

  it('rejects an empty list', () => {
    expect(
      TournamentOrderInputSchema.safeParse({tournamentIds: []}).success,
    ).toBe(false);
  });

  it('rejects the same tournament twice', () => {
    expect(
      TournamentOrderInputSchema.safeParse({tournamentIds: [A, A]}).success,
    ).toBe(false);
  });
});

describe('TournamentResetInputSchema', () => {
  it('accepts either choice about the accounts', () => {
    expect(
      TournamentResetInputSchema.safeParse({deleteParticipants: true}).success,
    ).toBe(true);
    expect(
      TournamentResetInputSchema.safeParse({deleteParticipants: false}).success,
    ).toBe(true);
  });

  it('rejects a body that leaves the accounts unspecified', () => {
    expect(TournamentResetInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('defaultTournamentName', () => {
  it('joins the region name and the type label', () => {
    expect(defaultTournamentName('東京', 'saikyoi')).toBe('東京最強位');
    expect(defaultTournamentName('大阪', 'shinjinou')).toBe('大阪新人王');
  });
});
