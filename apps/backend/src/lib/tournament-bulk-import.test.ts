import {afterAll, afterEach, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {
  defaultEntryClosesAt,
  importTournaments,
  parseTournamentIndex,
  TournamentIndexError,
} from './tournament-bulk-import';

const HEADER = [
  '地域',
  '種別',
  '実施日',
  '実施日（大会情報シートの表記）',
  'スプレッドシート名',
  'スプレッドシートID',
  'URL',
];

describe('parseTournamentIndex', () => {
  it('finds the columns by their headers', () => {
    const rows = parseTournamentIndex([
      HEADER,
      [
        '北海道',
        '最強位',
        '2026/12/26（土）',
        '12/26（土）',
        'name',
        'sheet-1',
      ],
    ]);

    expect(rows).toEqual([
      {
        row: 2,
        regionName: '北海道',
        typeLabel: '最強位',
        eventDate: '2026/12/26（土）',
        spreadsheetId: 'sheet-1',
      },
    ]);
  });

  it('copes with the columns being moved', () => {
    const rows = parseTournamentIndex([
      ['スプレッドシートID', '実施日', '種別', '地域'],
      ['sheet-1', '2026/12/26', '新人王', '東北'],
    ]);

    expect(rows[0]).toMatchObject({
      regionName: '東北',
      typeLabel: '新人王',
      spreadsheetId: 'sheet-1',
    });
  });

  it('skips blank rows but keeps the sheet row numbers', () => {
    const rows = parseTournamentIndex([
      HEADER,
      [],
      ['北海道', '最強位', '2026/12/26', '', '', 'sheet-1'],
    ]);

    expect(rows.map(row => row.row)).toEqual([3]);
  });

  it('refuses a sheet without one of the columns', () => {
    expect(() =>
      parseTournamentIndex([['地域', '種別', '実施日'], ['北海道']]),
    ).toThrow(TournamentIndexError);
  });
});

describe('defaultEntryClosesAt', () => {
  it('closes entry at 23:59 JST on the day before', () => {
    expect(defaultEntryClosesAt('2026/12/26（土）')).toBe(
      '2026-12-25T14:59:00.000Z',
    );
  });

  it('crosses month and year boundaries', () => {
    expect(defaultEntryClosesAt('2027/01/01')).toBe('2026-12-31T14:59:00.000Z');
    expect(defaultEntryClosesAt('2026-03-01')).toBe('2026-02-28T14:59:00.000Z');
  });

  it('reads nothing that is not a date', () => {
    for (const cell of ['', '調整中', '12/26', '2026/02/30']) {
      expect(defaultEntryClosesAt(cell)).toBeNull();
    }
  });
});

// Local Supabase stack (`supabase start`), same convention as the other
// integration suites. Skipped automatically when it isn't reachable.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Publicly documented local-dev demo key for Supabase CLI's default stack —
// not a real credential, safe to commit.
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function isDbReachable(): Promise<boolean> {
  const probe = new SQL(DB_URL);
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

/** An entry-form spreadsheet as the stub below serves it. */
interface FakeEntrySheet {
  formRows: unknown[][];
  /** `undefined` for a spreadsheet with no regulation tab. */
  regulationRows?: unknown[][];
}

describe.skipIf(!(await isDbReachable()))(
  'importTournaments (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const prefix = 'bulk-import-test';
    // Region names are what the sheet names, and they need not be unique,
    // so the test regions get names nothing else uses.
    const regionA = `${prefix}-地域A`;
    const regionB = `${prefix}-地域B`;
    const regionIds: Record<string, string> = {};

    // Every Sheets request goes to this stub; everything else (Supabase)
    // to the real fetch.
    const originalFetch = globalThis.fetch;
    let indexValues: unknown[][] = [];
    let entrySheets: Record<string, FakeEntrySheet> = {};

    function stubSheets(): void {
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.hostname !== 'sheets.googleapis.com') {
          return originalFetch(input as RequestInfo, init);
        }
        const id = /\/spreadsheets\/([^/]+)\/values/.exec(url.pathname)?.[1];
        if (id === 'index') {
          return Response.json({values: indexValues});
        }
        const sheet = id === undefined ? undefined : entrySheets[id];
        if (!sheet || sheet.regulationRows === undefined) {
          return Response.json({error: 'not found'}, {status: 400});
        }
        return Response.json({
          valueRanges: [
            {values: sheet.formRows},
            {values: sheet.regulationRows},
          ],
        });
      }) as unknown as typeof fetch;
    }

    async function deleteTestRows(): Promise<void> {
      await sql`delete from entries where tournament_id in (
        select t.id from tournaments t join regions r on r.id = t.region_id
        where r.slug like ${prefix + '%'}
      )`;
      await sql`delete from participants where email like ${prefix + '%'}`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${prefix + '%'}
      )`;
      await sql`delete from regions where slug like ${prefix + '%'}`;
    }

    beforeAll(async () => {
      await deleteTestRows();
      for (const [slug, name] of [
        [`${prefix}-a`, regionA],
        [`${prefix}-b`, regionB],
      ]) {
        const [region] = await sql`
          insert into regions (slug, name) values (${slug}, ${name})
          returning id
        `;
        regionIds[name] = region.id;
      }
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    afterAll(async () => {
      await deleteTestRows();
      await sql.close();
    });

    const NOW = new Date('2026-11-01T00:00:00.000Z');

    const FORM_ROWS = [
      ['tshirt_size', 'T シャツのサイズ', 'ラジオボタン', '必須', 'S, M, L'],
      ['notes', '備考', '自由記述', '任意'],
    ];
    const REGULATION_ROWS = [
      ['開催地域に在住の方', 46000, 46007],
      ['上記以外の方'],
    ];

    function indexRow(
      region: string,
      type: string,
      date: string,
      sheetId: string,
    ): unknown[] {
      return [region, type, date, '', '', sheetId];
    }

    async function tournamentOf(region: string, type: string) {
      const [row] = await sql`
        select id, name, capacity, entry_opens_at, entry_closes_at
        from tournaments
        where region_id = ${regionIds[region]} and type = ${type}
      `;
      return row as
        | {
            id: string;
            name: string | null;
            capacity: number | null;
            entry_opens_at: Date;
            entry_closes_at: Date;
          }
        | undefined;
    }

    it('registers a tournament with its form definition and regulations', async () => {
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', '2026/12/26（土）', 's1'),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const [result] = await importTournaments(env, 'index', NOW);

      expect(result).toMatchObject({
        row: 2,
        outcome: 'created',
        type: 'saikyoi',
        entryOpensAt: NOW.toISOString(),
        entryClosesAt: '2026-12-25T14:59:00.000Z',
        error: null,
      });
      const tournament = await tournamentOf(regionA, 'saikyoi');
      expect(tournament?.id).toBe(result.tournamentId as string);
      // Left blank: the default name (地域名＋種別) is used.
      expect(tournament?.name).toBeNull();
      expect(tournament?.entry_opens_at.toISOString()).toBe(NOW.toISOString());
      expect(tournament?.entry_closes_at.toISOString()).toBe(
        '2026-12-25T14:59:00.000Z',
      );
      const fields = await sql`
        select field_key, field_type, required, options from form_field_defs
        where tournament_id = ${result.tournamentId} order by display_order
      `;
      expect(fields).toEqual([
        {
          field_key: 'tshirt_size',
          field_type: 'radio',
          required: true,
          options: ['S', 'M', 'L'],
        },
        {
          field_key: 'notes',
          field_type: 'textarea',
          required: false,
          options: null,
        },
      ]);
      const regulations = await sql`
        select label, priority_starts_at from regulations
        where tournament_id = ${result.tournamentId} order by display_order
      `;
      expect(regulations.map((r: {label: string}) => r.label)).toEqual([
        '開催地域に在住の方',
        '上記以外の方',
      ]);
      expect(regulations[0].priority_starts_at).not.toBeNull();
      expect(regulations[1].priority_starts_at).toBeNull();
    });

    it('overwrites a registered tournament, keeping what the sheet does not carry', async () => {
      const before = await tournamentOf(regionA, 'saikyoi');
      expect(before).toBeDefined();
      await sql`
        update tournaments set name = '手で付けた名前', capacity = 40
        where id = ${before?.id}
      `;
      const [regulationBefore] = await sql`
        select id from regulations
        where tournament_id = ${before?.id} and label = '上記以外の方'
      `;
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', '2026/12/27（日）', 's1'),
      ];
      entrySheets = {
        s1: {
          formRows: [FORM_ROWS[1]],
          regulationRows: [['上記以外の方'], ['新しいレギュレーション']],
        },
      };
      stubSheets();
      const later = new Date('2026-11-02T00:00:00.000Z');

      const [result] = await importTournaments(env, 'index', later);

      expect(result).toMatchObject({
        outcome: 'updated',
        tournamentId: before?.id,
        entryClosesAt: '2026-12-26T14:59:00.000Z',
      });
      const after = await tournamentOf(regionA, 'saikyoi');
      expect(after?.name).toBe('手で付けた名前');
      expect(after?.capacity).toBe(40);
      expect(after?.entry_opens_at.toISOString()).toBe(later.toISOString());
      const fields = await sql`
        select field_key from form_field_defs where tournament_id = ${before?.id}
      `;
      expect(fields).toEqual([{field_key: 'notes'}]);
      // Matched by name, so entries pointing at it keep pointing at it.
      const [regulationAfter] = await sql`
        select id from regulations
        where tournament_id = ${before?.id} and label = '上記以外の方'
      `;
      expect(regulationAfter.id).toBe(regulationBefore.id);
    });

    it('writes nothing of a tournament whose regulations are still in use', async () => {
      const tournament = await tournamentOf(regionA, 'saikyoi');
      const [regulation] = await sql`
        select id from regulations
        where tournament_id = ${tournament?.id} and label = '上記以外の方'
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${regionIds[regionA]}, ${prefix + '@example.com'}, 'hash')
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name
        ) values (
          ${participant.id}, ${tournament?.id}, '山田太郎', 'ヤマダタロウ', '太郎'
        )
        returning id
      `;
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entry.id}, ${regulation.id}, ${tournament?.id})
      `;
      indexValues = [HEADER, indexRow(regionA, '最強位', '2026/12/28', 's1')];
      entrySheets = {
        s1: {
          formRows: FORM_ROWS,
          regulationRows: [['名前を変えたレギュレーション']],
        },
      };
      stubSheets();

      const [result] = await importTournaments(
        env,
        'index',
        new Date('2026-11-03T00:00:00.000Z'),
      );

      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('上記以外の方');
      // Rolled back as a whole: the entry period and the form are as before.
      const after = await tournamentOf(regionA, 'saikyoi');
      expect(after?.entry_closes_at.toISOString()).toBe(
        '2026-12-26T14:59:00.000Z',
      );
      const fields = await sql`
        select field_key from form_field_defs where tournament_id = ${tournament?.id}
      `;
      expect(fields).toEqual([{field_key: 'notes'}]);
    });

    it('reports each failed row and registers the rest', async () => {
      indexValues = [
        HEADER,
        indexRow('存在しない地域', '最強位', '2026/12/26', 's1'),
        indexRow(regionB, '宮崎', '2026/12/26', 's1'),
        indexRow(regionB, '新人王', '', 's1'),
        indexRow(regionB, '新人王', '2026/10/01', 's1'),
        indexRow(regionA, '新人王', '2026/12/26', 'missing-tab'),
        indexRow(regionB, '最強位', '2026/12/20', 's1'),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
        'missing-tab': {formRows: FORM_ROWS},
      };
      stubSheets();

      const results = await importTournaments(env, 'index', NOW);

      expect(results.map(r => [r.row, r.outcome])).toEqual([
        [2, 'failed'],
        [3, 'failed'],
        [4, 'failed'],
        [5, 'failed'],
        [6, 'failed'],
        [7, 'created'],
      ]);
      expect(results[0].error).toContain(
        '地域「存在しない地域」が登録されていません',
      );
      expect(results[1].error).toContain('種別「宮崎」');
      // Rows 4 and 5 are both 地域B 新人王, so neither is registered.
      expect(results[2].error).toContain('5行目');
      expect(results[3].error).toContain('4行目');
      expect(results[4].error).toContain('レギュレーション');
      expect(await tournamentOf(regionB, 'shinjinou')).toBeUndefined();
      expect(await tournamentOf(regionA, 'shinjinou')).toBeUndefined();
      expect(await tournamentOf(regionB, 'saikyoi')).toBeDefined();
    });

    it('refuses a tournament whose entry would already have closed', async () => {
      indexValues = [HEADER, indexRow(regionB, '新人王', '2026/11/01', 's1')];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const [result] = await importTournaments(env, 'index', NOW);

      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('締切');
    });

    it('refuses a form definition the sheet gets wrong', async () => {
      indexValues = [HEADER, indexRow(regionB, '新人王', '2026/12/26', 's1')];
      entrySheets = {
        s1: {
          formRows: [['notes', '備考', 'プルダウン', '任意']],
          regulationRows: REGULATION_ROWS,
        },
      };
      stubSheets();

      const [result] = await importTournaments(env, 'index', NOW);

      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('プルダウン');
      expect(await tournamentOf(regionB, 'shinjinou')).toBeUndefined();
    });
  },
);
