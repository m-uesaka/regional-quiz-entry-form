import {describe, expect, it} from 'bun:test';
import {
  defaultTournamentName,
  TournamentCreateInputSchema,
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

describe('TournamentUpdateInputSchema', () => {
  it('leaves an omitted name out, so the stored one is kept', () => {
    expect(TournamentUpdateInputSchema.parse({capacity: 10})).toEqual({
      capacity: 10,
    });
  });
});

describe('defaultTournamentName', () => {
  it('joins the region name and the type label', () => {
    expect(defaultTournamentName('東京', 'saikyoi')).toBe('東京最強位');
    expect(defaultTournamentName('大阪', 'shinjinou')).toBe('大阪新人王');
  });
});
