import {describe, expect, it} from 'vitest';
import type {PortalTournament} from '@regional-quiz/shared';
import {
  DUAL_ENTRY_NOTICE,
  groupPortalTournaments,
  portalStatus,
  tournamentEntryListPath,
  tournamentPublicPath,
} from './portal';

const OPENS_AT = '2026-11-01T00:00:00Z';
const CLOSES_AT = '2026-11-30T00:00:00Z';

function tournament(
  overrides: Partial<PortalTournament> = {},
): PortalTournament {
  return {
    regionSlug: 'tokyo',
    regionName: '東京',
    regionAllowsDualEntry: false,
    tournamentType: 'saikyoi',
    tournamentName: '東京大会',
    entryOpensAt: OPENS_AT,
    entryClosesAt: CLOSES_AT,
    capacity: null,
    priorityRegulations: [],
    ...overrides,
  };
}

describe('tournamentPublicPath', () => {
  it('puts the region slug and the tournament type in the path', () => {
    expect(tournamentPublicPath('tokyo', 'saikyoi')).toBe('/tokyo/saikyoi');
  });

  it('encodes a region slug that would otherwise change the URL', () => {
    expect(tournamentPublicPath('a?b#c', 'shinjinou')).toBe(
      '/a%3Fb%23c/shinjinou',
    );
  });
});

describe('tournamentEntryListPath', () => {
  it('points at the list page under the tournament', () => {
    expect(tournamentEntryListPath('tokyo', 'saikyoi')).toBe(
      '/tokyo/saikyoi/list',
    );
  });
});

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
      entryListPath: '/tokyo/shinjinou/list',
      entryPeriodLabel: '2026年11月1日(日) 9:00 〜 2026年11月30日(月) 9:00',
    });
  });

  // The API sorts by region, but the grouping must not depend on it: a
  // region split across the list would otherwise come out twice.
  it('keeps one group per region even when its tournaments are apart', () => {
    const regions = groupPortalTournaments(
      [
        tournament({tournamentName: '東京最強位'}),
        tournament({
          regionSlug: 'hokkaido',
          regionName: '北海道',
          tournamentName: '北海道最強位',
        }),
        tournament({tournamentType: 'shinjinou', tournamentName: '東京新人王'}),
      ],
      now,
    );

    expect(regions.map(r => r.regionSlug)).toEqual(['tokyo', 'hokkaido']);
    expect(regions[0].tournaments.map(t => t.name)).toEqual([
      '東京最強位',
      '東京新人王',
    ]);
  });

  it('labels the capacity, or leaves it out when there is none', () => {
    const [region] = groupPortalTournaments(
      [tournament({capacity: 48}), tournament({tournamentType: 'shinjinou'})],
      now,
    );

    expect(region.tournaments.map(t => t.capacityLabel)).toEqual([
      '定員: 48名',
      null,
    ]);
  });

  it('announces a 優先エントリー only while its form is open', () => {
    const priorityRegulations = [
      {
        label: '在住',
        priorityStartsAt: '2026-10-01T00:00:00Z',
        priorityEndsAt: '2026-12-31T00:00:00Z',
      },
    ];
    const [region] = groupPortalTournaments(
      [
        tournament({priorityRegulations}),
        tournament({
          tournamentType: 'shinjinou',
          entryOpensAt: '2026-11-20T00:00:00Z',
          priorityRegulations,
        }),
      ],
      now,
    );

    expect(region.tournaments.map(t => t.priorityNotices)).toEqual([
      [{labels: ['在住'], endsAtLabel: '2026年12月31日(木) 9:00'}],
      [],
    ]);
  });

  it('says a region allows both entries only when it lists both types', () => {
    const regions = groupPortalTournaments(
      [
        tournament({regionAllowsDualEntry: true}),
        tournament({regionAllowsDualEntry: true, tournamentType: 'shinjinou'}),
        // Allowed, but with only a 最強位 there is nothing to enter both of.
        tournament({
          regionSlug: 'hokkaido',
          regionName: '北海道',
          regionAllowsDualEntry: true,
        }),
        tournament({regionSlug: 'osaka', regionName: '大阪'}),
        tournament({
          regionSlug: 'osaka',
          regionName: '大阪',
          tournamentType: 'shinjinou',
        }),
      ],
      now,
    );

    expect(regions.map(r => [r.regionName, r.allowsDualEntry])).toEqual([
      ['東京', true],
      ['北海道', false],
      ['大阪', false],
    ]);
  });

  it('allows both entries whatever the forms statuses are', () => {
    const [region] = groupPortalTournaments(
      [
        tournament({
          regionAllowsDualEntry: true,
          entryOpensAt: '2026-12-01T00:00:00Z',
          entryClosesAt: '2026-12-31T00:00:00Z',
        }),
        tournament({
          regionAllowsDualEntry: true,
          tournamentType: 'shinjinou',
          entryClosesAt: '2026-11-10T00:00:00Z',
        }),
      ],
      now,
    );

    expect(region.tournaments.map(t => t.status)).toEqual([
      'upcoming',
      'closed',
    ]);
    expect(region.allowsDualEntry).toBe(true);
  });

  // The setting is the region's, so every row should agree; if they don't,
  // the answer must not depend on which one came last.
  it('allows both entries only when every row of the region says so', () => {
    for (const order of [
      [true, false],
      [false, true],
    ]) {
      const [region] = groupPortalTournaments(
        [
          tournament({regionAllowsDualEntry: order[0]}),
          tournament({
            regionAllowsDualEntry: order[1],
            tournamentType: 'shinjinou',
          }),
        ],
        now,
      );
      expect(region.allowsDualEntry).toBe(false);
    }
  });

  it('names both tournament types in the notice', () => {
    expect(DUAL_ENTRY_NOTICE).toBe(
      'この地域は最強位と新人王の両方にエントリー可能です(重複エントリー可)',
    );
  });

  it('answers no regions when there are no tournaments', () => {
    expect(groupPortalTournaments([], now)).toEqual([]);
  });
});
