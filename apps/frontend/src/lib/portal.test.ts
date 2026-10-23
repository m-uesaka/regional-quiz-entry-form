import {describe, expect, it} from 'vitest';
import type {PortalTournament} from '@regional-quiz/shared';
import {groupPortalTournaments, portalStatus} from './portal';

const OPENS_AT = '2026-11-01T00:00:00Z';
const CLOSES_AT = '2026-11-30T00:00:00Z';

function tournament(
  overrides: Partial<PortalTournament> = {},
): PortalTournament {
  return {
    regionSlug: 'tokyo',
    regionName: '東京',
    tournamentType: 'saikyoi',
    tournamentName: '東京大会',
    entryOpensAt: OPENS_AT,
    entryClosesAt: CLOSES_AT,
    ...overrides,
  };
}

describe('portalStatus', () => {
  it('is upcoming before the window opens', () => {
    expect(portalStatus(tournament(), new Date('2026-10-31T23:59:59Z'))).toBe(
      'upcoming',
    );
  });

  // Inclusive at both ends, like the backend's entry-period gate: a form the
  // portal calls open must be one the gate lets participants into.
  it('is open from the opening instant to the closing instant inclusive', () => {
    expect(portalStatus(tournament(), new Date(OPENS_AT))).toBe('open');
    expect(portalStatus(tournament(), new Date(CLOSES_AT))).toBe('open');
  });

  it('is closed once the window has passed', () => {
    expect(portalStatus(tournament(), new Date('2026-11-30T00:00:01Z'))).toBe(
      'closed',
    );
  });
});

describe('groupPortalTournaments', () => {
  const now = new Date('2026-11-15T00:00:00Z');

  it('groups consecutive tournaments of a region, keeping the API order', () => {
    const regions = groupPortalTournaments(
      [
        tournament({tournamentName: '東京最強位'}),
        tournament({tournamentType: 'shinjinou', tournamentName: '東京新人王'}),
        tournament({
          regionSlug: 'hokkaido',
          regionName: '北海道',
          tournamentName: '北海道最強位',
        }),
      ],
      now,
    );

    expect(regions.map(r => r.regionName)).toEqual(['東京', '北海道']);
    expect(regions[0].tournaments.map(t => t.name)).toEqual([
      '東京最強位',
      '東京新人王',
    ]);
    expect(regions[1].tournaments).toHaveLength(1);
  });

  it('links each tournament to its entry form and labels its type', () => {
    const [region] = groupPortalTournaments(
      [tournament({tournamentType: 'shinjinou'})],
      now,
    );

    expect(region.tournaments[0]).toMatchObject({
      typeLabel: '新人王',
      status: 'open',
      entryPath: '/tokyo/shinjinou/entry',
    });
  });

  it('answers no regions when there are no tournaments', () => {
    expect(groupPortalTournaments([], now)).toEqual([]);
  });
});
