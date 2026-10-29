import {afterAll, afterEach, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {TournamentImportSelection} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {
  importTournaments,
  parseCapacity,
  parseJstDateTime,
  parseTournamentIndex,
  previewTournamentImport,
  TournamentIndexError,
} from './tournament-bulk-import';

// The 大会一覧 sheet's header, as the sheet staff use has it.
const HEADER = [
  '地域',
  '種別',
  '実施日',
  '定員',
  'エントリー開始',
  'エントリー終了',
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
        '54',
        '2026/11/04 21:00:00',
        '2026/12/16 23:59:59',
        'name',
        'sheet-1',
      ],
    ]);

    expect(rows).toEqual([
      {
        row: 2,
        regionName: '北海道',
        typeLabel: '最強位',
        capacity: '54',
        entryOpensAt: '2026/11/04 21:00:00',
        entryClosesAt: '2026/12/16 23:59:59',
        spreadsheetId: 'sheet-1',
      },
    ]);
  });

  it('copes with the columns being moved', () => {
    const rows = parseTournamentIndex([
      [
        'スプレッドシートID',
        'エントリー終了',
        'エントリー開始',
        '定員',
        '種別',
        '地域',
      ],
      ['sheet-1', '2026/12/18 23:59', '2026/10/31 0:00', '', '新人王', '東北'],
    ]);

    expect(rows[0]).toMatchObject({
      regionName: '東北',
      typeLabel: '新人王',
      capacity: '',
      entryOpensAt: '2026/10/31 0:00',
      spreadsheetId: 'sheet-1',
    });
  });

  it('skips blank rows but keeps the sheet row numbers', () => {
    const rows = parseTournamentIndex([
      HEADER,
      [],
      ['北海道', '最強位', '', '', '', '', '', 'sheet-1'],
    ]);

    expect(rows.map(row => row.row)).toEqual([3]);
  });

  it('refuses a sheet without one of the columns', () => {
    // The 大会一覧 before 定員 and the entry period had their own columns.
    expect(() =>
      parseTournamentIndex([
        ['地域', '種別', '実施日', 'スプレッドシートID'],
        ['北海道'],
      ]),
    ).toThrow(TournamentIndexError);
  });
});

describe('parseJstDateTime', () => {
  it('reads the date-time on the sheet as Japan time', () => {
    expect(parseJstDateTime('2026/11/04 21:00:00')).toBe(
      '2026-11-04T12:00:00.000Z',
    );
    expect(parseJstDateTime('2026/12/16 23:59:59')).toBe(
      '2026-12-16T14:59:59.000Z',
    );
    // Midnight, as the sheet displays it: no leading zero on the hour.
    expect(parseJstDateTime('2026/10/31 0:00:00')).toBe(
      '2026-10-30T15:00:00.000Z',
    );
    expect(parseJstDateTime('2026-10-31 21:00')).toBe(
      '2026-10-31T12:00:00.000Z',
    );
  });

  it('reads nothing that is not a date and time', () => {
    for (const cell of [
      '',
      '調整中',
      '2026/12/16',
      '12/16 23:59',
      '2026/02/30 12:00',
      '2026/12/16 24:00',
    ]) {
      expect(parseJstDateTime(cell)).toBeNull();
    }
  });
});

describe('parseCapacity', () => {
  it('reads a whole number, or blank as no capacity', () => {
    expect(parseCapacity('54')).toBe(54);
    expect(parseCapacity('1,000')).toBe(1000);
    expect(parseCapacity('60人')).toBe(60);
    expect(parseCapacity('')).toBeNull();
  });

  it('refuses anything else', () => {
    for (const cell of ['0', '-5', '12.5', '未定', '五十']) {
      expect(parseCapacity(cell)).toBeUndefined();
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

/**
 * A cell the stub below serves: a string or number is both what the sheet
 * displays and its value; `{shown, value}` is a cell whose display differs
 * from its value, e.g. a percentage.
 */
type FakeCell = string | number | {shown: string; value: number} | undefined;

/** An entry-form spreadsheet as the stub below serves it. */
interface FakeEntrySheet {
  formRows: FakeCell[][];
  /** `undefined` for a spreadsheet with no regulation tab. */
  regulationRows?: FakeCell[][];
}

/** A `spreadsheets.get` grid row for `cells`. */
function gridRow(cells: FakeCell[]) {
  return {
    values: cells.map(cell => {
      if (cell === undefined) return {};
      if (typeof cell === 'object') {
        return {
          formattedValue: cell.shown,
          effectiveValue: {numberValue: cell.value},
        };
      }
      return {
        formattedValue: String(cell),
        effectiveValue:
          typeof cell === 'number' ? {numberValue: cell} : {stringValue: cell},
      };
    }),
  };
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
    let requestedSheetIds: string[] = [];

    function stubSheets(): void {
      requestedSheetIds = [];
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
        const id = decodeURIComponent(
          /\/spreadsheets\/([^/?]+)/.exec(url.pathname)?.[1] ?? '',
        );
        if (id === 'index') {
          return Response.json({values: indexValues});
        }
        requestedSheetIds.push(id);
        const sheet = entrySheets[id];
        if (!sheet || sheet.regulationRows === undefined) {
          return Response.json({error: 'not found'}, {status: 400});
        }
        // `spreadsheets.get` with grid data: the form tab first, as the
        // spreadsheet orders its tabs.
        return Response.json({
          sheets: [
            {
              properties: {title: 'フォーム定義'},
              data: [{rowData: sheet.formRows.map(gridRow)}],
            },
            {
              properties: {title: 'レギュレーション'},
              data: [{rowData: sheet.regulationRows.map(gridRow)}],
            },
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
    const OPENS = '2026/11/04 21:00:00';
    const OPENS_ISO = '2026-11-04T12:00:00.000Z';
    const CLOSES = '2026/12/16 23:59:59';
    const CLOSES_ISO = '2026-12-16T14:59:59.000Z';

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
      sheetId: string,
      period: {capacity?: string; opens?: string; closes?: string} = {},
    ): unknown[] {
      return [
        region,
        type,
        '2026/12/26（土）',
        period.capacity ?? '',
        period.opens ?? OPENS,
        period.closes ?? CLOSES,
        '',
        sheetId,
      ];
    }

    function select(
      regionName: string,
      typeLabel: string,
      action: TournamentImportSelection['action'],
    ): TournamentImportSelection {
      return {regionName, typeLabel, action};
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

    it('previews a new tournament without writing anything', async () => {
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', 's1', {capacity: '54'}),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const [row] = await previewTournamentImport(env, 'index', NOW);

      expect(row).toEqual({
        row: 2,
        regionName: regionA,
        typeLabel: '最強位',
        action: 'create',
        error: null,
        capacity: 54,
        entryOpensAt: OPENS_ISO,
        entryClosesAt: CLOSES_ISO,
        formFieldLabels: ['T シャツのサイズ', '備考'],
        regulationLabels: ['開催地域に在住の方', '上記以外の方'],
        current: null,
      });
      expect(await tournamentOf(regionA, 'saikyoi')).toBeUndefined();
    });

    it('registers a tournament with its form definition and regulations', async () => {
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', 's1', {capacity: '54'}),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const [result] = await importTournaments(
        env,
        'index',
        [select(regionA, '最強位', 'create')],
        NOW,
      );

      expect(result).toMatchObject({
        row: 2,
        outcome: 'created',
        type: 'saikyoi',
        capacity: 54,
        entryOpensAt: OPENS_ISO,
        entryClosesAt: CLOSES_ISO,
        error: null,
      });
      const tournament = await tournamentOf(regionA, 'saikyoi');
      expect(tournament?.id).toBe(result.tournamentId as string);
      // Left blank: the default name (地域名＋種別) is used.
      expect(tournament?.name).toBeNull();
      expect(tournament?.capacity).toBe(54);
      expect(tournament?.entry_opens_at.toISOString()).toBe(OPENS_ISO);
      expect(tournament?.entry_closes_at.toISOString()).toBe(CLOSES_ISO);
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

    it('previews a registered tournament as an overwrite, with what it holds now', async () => {
      const before = await tournamentOf(regionA, 'saikyoi');
      await sql`
        update tournaments set name = '手で付けた名前' where id = ${before?.id}
      `;
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', 's1', {
          capacity: '40',
          opens: '2026/11/10 0:00:00',
          closes: '2026/12/20 23:59:59',
        }),
      ];
      stubSheets();

      const [row] = await previewTournamentImport(env, 'index', NOW);

      expect(row).toMatchObject({
        action: 'overwrite',
        capacity: 40,
        entryOpensAt: '2026-11-09T15:00:00.000Z',
        current: {
          tournamentId: before?.id,
          name: '手で付けた名前',
          capacity: 54,
          entryOpensAt: OPENS_ISO,
          entryClosesAt: CLOSES_ISO,
        },
      });
    });

    it('overwrites a registered tournament, keeping its name', async () => {
      const before = await tournamentOf(regionA, 'saikyoi');
      expect(before).toBeDefined();
      const [regulationBefore] = await sql`
        select id from regulations
        where tournament_id = ${before?.id} and label = '上記以外の方'
      `;
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', 's1', {
          opens: '2026/11/10 0:00:00',
          closes: '2026/12/20 23:59:59',
        }),
      ];
      entrySheets = {
        s1: {
          formRows: [FORM_ROWS[1]],
          regulationRows: [['上記以外の方'], ['新しいレギュレーション']],
        },
      };
      stubSheets();

      const [result] = await importTournaments(
        env,
        'index',
        [select(regionA, '最強位', 'overwrite')],
        NOW,
      );

      expect(result).toMatchObject({
        outcome: 'updated',
        tournamentId: before?.id,
        capacity: null,
        entryOpensAt: '2026-11-09T15:00:00.000Z',
        entryClosesAt: '2026-12-20T14:59:59.000Z',
      });
      const after = await tournamentOf(regionA, 'saikyoi');
      expect(after?.name).toBe('手で付けた名前');
      // Blank on the sheet: no capacity.
      expect(after?.capacity).toBeNull();
      expect(after?.entry_opens_at.toISOString()).toBe(
        '2026-11-09T15:00:00.000Z',
      );
      expect(after?.entry_closes_at.toISOString()).toBe(
        '2026-12-20T14:59:59.000Z',
      );
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

    // Someone else registered or deleted the tournament after the preview:
    // what staff chose no longer fits, so nothing is done.
    it('does only what was chosen', async () => {
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', 's1', {capacity: '99'}),
        indexRow(regionB, '最強位', 's1', {capacity: '99'}),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const results = await importTournaments(
        env,
        'index',
        [
          select(regionA, '最強位', 'create'),
          select(regionB, '最強位', 'overwrite'),
        ],
        NOW,
      );

      expect(results.map(r => r.outcome)).toEqual(['failed', 'failed']);
      expect(results[0].error).toContain('別の操作で登録されました');
      expect(results[1].error).toContain('別の操作で削除されました');
      expect((await tournamentOf(regionA, 'saikyoi'))?.capacity).toBeNull();
      expect(await tournamentOf(regionB, 'saikyoi')).toBeUndefined();
    });

    it('registers only the rows chosen', async () => {
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', 's1', {capacity: '99'}),
        indexRow(regionB, '最強位', 's1'),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const results = await importTournaments(
        env,
        'index',
        [select(regionB, '最強位', 'create')],
        NOW,
      );

      expect(results.map(r => [r.row, r.outcome])).toEqual([[3, 'created']]);
      // Not chosen, so left as it was.
      expect((await tournamentOf(regionA, 'saikyoi'))?.capacity).toBeNull();
      expect(requestedSheetIds).toEqual(['s1']);
      await sql`delete from tournaments where id = ${results[0].tournamentId}`;
    });

    it('reports a chosen row that is no longer on the sheet', async () => {
      indexValues = [HEADER];
      stubSheets();

      const [result] = await importTournaments(
        env,
        'index',
        [select(regionB, '新人王', 'create')],
        NOW,
      );

      expect(result).toMatchObject({row: null, outcome: 'failed'});
      expect(result.error).toContain('見つかりません');
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
      indexValues = [
        HEADER,
        indexRow(regionA, '最強位', 's1', {closes: '2026/12/28 23:59'}),
      ];
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
        [select(regionA, '最強位', 'overwrite')],
        NOW,
      );

      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('上記以外の方');
      // Rolled back as a whole: the entry period and the form are as before.
      const after = await tournamentOf(regionA, 'saikyoi');
      expect(after?.entry_closes_at.toISOString()).toBe(
        '2026-12-20T14:59:59.000Z',
      );
      const fields = await sql`
        select field_key from form_field_defs where tournament_id = ${tournament?.id}
      `;
      expect(fields).toEqual([{field_key: 'notes'}]);
    });

    it('previews why each row that cannot be registered cannot', async () => {
      indexValues = [
        HEADER,
        indexRow('存在しない地域', '最強位', 's1'),
        indexRow(regionB, '宮崎', 's1'),
        indexRow(regionB, '新人王', 's1', {capacity: '未定'}),
        indexRow(regionB, '最強位', 's1', {opens: '調整中'}),
        indexRow(regionB, '最強位', 's1', {closes: '2026/12/16'}),
        indexRow(regionA, '新人王', 'missing-tab'),
        indexRow(regionA, '新人王', 's1'),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
        'missing-tab': {formRows: FORM_ROWS},
      };
      stubSheets();

      const rows = await previewTournamentImport(env, 'index', NOW);

      expect(rows.map(r => [r.row, r.action])).toEqual([
        [2, null],
        [3, null],
        [4, null],
        [5, null],
        [6, null],
        [7, null],
        [8, null],
      ]);
      expect(rows[0].error).toContain(
        '地域「存在しない地域」が登録されていません',
      );
      expect(rows[1].error).toContain('種別「宮崎」');
      expect(rows[2].error).toContain('定員「未定」');
      // Rows 5 and 6 are both 地域B 最強位, so neither is registered.
      expect(rows[3].error).toContain('6行目');
      expect(rows[4].error).toContain('5行目');
      expect(rows[5].error).toContain('8行目');
      expect(rows[6].error).toContain('7行目');

      indexValues = [
        HEADER,
        indexRow(regionB, '最強位', 's1', {opens: '調整中'}),
        indexRow(regionB, '新人王', 's1', {closes: '2026/12/16'}),
        indexRow(regionA, '新人王', 'missing-tab'),
      ];
      const single = await previewTournamentImport(env, 'index', NOW);
      expect(single[0].error).toContain('エントリー開始「調整中」');
      expect(single[1].error).toContain('エントリー終了「2026/12/16」');
      expect(single[2].error).toContain('レギュレーション');
      expect(await tournamentOf(regionB, 'shinjinou')).toBeUndefined();
    });

    it('refuses an entry period that is reversed or already over', async () => {
      indexValues = [
        HEADER,
        indexRow(regionB, '新人王', 's1', {
          opens: '2026/12/20 0:00',
          closes: '2026/12/10 0:00',
        }),
        indexRow(regionB, '最強位', 's1', {
          opens: '2026/10/01 0:00',
          closes: '2026/10/31 23:59',
        }),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const rows = await previewTournamentImport(env, 'index', NOW);

      expect(rows[0].error).toContain('エントリー開始がエントリー終了より後');
      expect(rows[1].error).toContain('既に過ぎています');
    });

    it('refuses a form definition the sheet gets wrong', async () => {
      indexValues = [HEADER, indexRow(regionB, '新人王', 's1')];
      entrySheets = {
        s1: {
          formRows: [['notes', '備考', 'プルダウン', '任意']],
          regulationRows: REGULATION_ROWS,
        },
      };
      stubSheets();

      const [result] = await importTournaments(
        env,
        'index',
        [select(regionB, '新人王', 'create')],
        NOW,
      );

      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('プルダウン');
      expect(await tournamentOf(regionB, 'shinjinou')).toBeUndefined();
    });

    // The form tab is read as displayed, as the edit screen's import reads
    // it; its value would turn `10%` into `0.1`.
    it('keeps form cells as the sheet displays them', async () => {
      indexValues = [HEADER, indexRow(regionB, '新人王', 's1')];
      entrySheets = {
        s1: {
          formRows: [
            [
              'discount',
              '割引',
              'ラジオボタン',
              '必須',
              {shown: '10%', value: 0.1},
            ],
          ],
          regulationRows: REGULATION_ROWS,
        },
      };
      stubSheets();

      const [result] = await importTournaments(
        env,
        'index',
        [select(regionB, '新人王', 'create')],
        NOW,
      );

      expect(result.outcome).toBe('created');
      const [field] = await sql`
        select options from form_field_defs
        where tournament_id = ${result.tournamentId}
      `;
      expect(field.options).toEqual(['10%']);
      await sql`delete from tournaments where id = ${result.tournamentId}`;
    });

    // Staff paste URLs into the column as readily as IDs.
    it('reads the entry sheet a URL in the ID column names', async () => {
      indexValues = [
        HEADER,
        indexRow(
          regionB,
          '新人王',
          'https://docs.google.com/spreadsheets/d/s1/edit?gid=0#gid=0',
        ),
      ];
      entrySheets = {
        s1: {formRows: FORM_ROWS, regulationRows: REGULATION_ROWS},
      };
      stubSheets();

      const [result] = await importTournaments(
        env,
        'index',
        [select(regionB, '新人王', 'create')],
        NOW,
      );

      expect(result.outcome).toBe('created');
      expect(requestedSheetIds).toEqual(['s1']);
      await sql`delete from tournaments where id = ${result.tournamentId}`;
    });

    it('names the form row a mistake is on, in Japanese', async () => {
      const cases: Array<[FakeCell[][], string]> = [
        [
          [FORM_ROWS[0], ['Bad Key', '備考', '自由記述', '任意']],
          'フォーム定義 3行目: A列(key)「Bad Key」',
        ],
        [
          [FORM_ROWS[0], [], FORM_ROWS[1]],
          'フォーム定義 3行目: C列(type)が空です',
        ],
        [
          [['size', 'サイズ', 'ラジオボタン', '必須', 'S, S']],
          'フォーム定義 2行目: E列(options)に同じ選択肢が複数あります',
        ],
        [
          [['size', 'サイズ', 'ラジオボタン', '必須']],
          'フォーム定義 2行目: ラジオボタンには E列(options)',
        ],
        [
          [FORM_ROWS[1], FORM_ROWS[1]],
          'フォーム定義: A列(key)「notes」が複数の行で使われています',
        ],
      ];
      for (const [formRows, message] of cases) {
        indexValues = [HEADER, indexRow(regionB, '新人王', 's1')];
        entrySheets = {s1: {formRows, regulationRows: REGULATION_ROWS}};
        stubSheets();

        const [row] = await previewTournamentImport(env, 'index', NOW);

        expect(row.action).toBeNull();
        expect(row.error).toStartWith(message);
      }
      expect(await tournamentOf(regionB, 'shinjinou')).toBeUndefined();
    });
  },
);
