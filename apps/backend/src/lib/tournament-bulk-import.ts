// Registers every tournament listed on a 大会一覧 spreadsheet (#168).
//
// Each row of the sheet names a region, a tournament type, the day the
// tournament is held, and the region staff's own entry-form spreadsheet --
// the same one the edit screen imports a form definition and regulations
// from (`docs/google-sheets-integration.md`). A row is registered as a whole
// (the tournament, its form definition and its regulations) by
// `import_tournament()` in one transaction, or not at all: a row that fails
// anywhere is reported back with the reason and left for staff to register
// by hand, while the rest go ahead.
import {
  parseFormDefinitionYaml,
  REGULATION_SHEET_NAME,
  TOURNAMENT_TYPE_LABELS,
  TournamentTypeSchema,
  type TournamentImportResult,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {formFieldDefSyncRows} from './form-definitions';
import {
  RegulationInUseError,
  regulationSyncError,
  UnknownRegulationError,
} from './regulations';
import {classifySheetImportError} from './sheet-import-errors';
import {
  fetchSheetBatch,
  fetchSheetValues,
  FORM_DEFINITION_RANGE,
  SheetFetchError,
  sheetRowsToYaml,
  sheetValuesToRows,
} from './sheet-to-form-definition';
import {sheetValuesToRegulations} from './sheet-to-regulations';

/** The headers of the 大会一覧 sheet's columns this reads. */
const HEADERS = {
  region: '地域',
  type: '種別',
  eventDate: '実施日',
  spreadsheetId: 'スプレッドシートID',
} as const;

// The 大会一覧 sheet is the first tab. The whole width is read so the
// columns can be found by their headers rather than by position: the sheet
// carries other columns (a display copy of the date, the spreadsheet's name
// and URL) that may move.
const INDEX_RANGE = 'A1:Z';

// How many tournaments are fetched and written at once. Every row costs one
// Sheets request and one database call, so this bounds how hard a long list
// hits either, while still finishing a few dozen rows in seconds rather
// than one round trip after another.
const CONCURRENCY = 4;

// Japan Standard Time has no daylight saving, so a fixed offset turns a
// wall-clock time into an instant.
const JST_OFFSET_HOURS = 9;

// `2026/12/26（土）`, `2026/12/26`, `2026-12-26`: the date first, whatever
// follows it (the day of the week, in either width of brackets).
const EVENT_DATE_PATTERN = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/;

const TYPES_BY_LABEL = new Map<string, TournamentType>(
  TournamentTypeSchema.options.map(type => [
    TOURNAMENT_TYPE_LABELS[type],
    type,
  ]),
);

/** One row of the 大会一覧 sheet, as written. */
export interface TournamentIndexRow {
  /** The row number the sheet shows. */
  row: number;
  regionName: string;
  typeLabel: string;
  eventDate: string;
  spreadsheetId: string;
}

/**
 * Thrown when the 大会一覧 sheet itself can't be used -- as opposed to one of
 * its rows, which is reported per row. Staff-facing.
 */
export class TournamentIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TournamentIndexError';
  }
}

/**
 * Turns the cells of the 大会一覧 sheet into its rows, finding each column
 * by its header in row 1. Rows with nothing in any of those columns are
 * skipped.
 * @param values The sheet's cells, row 1 first.
 * @throws {TournamentIndexError} If a header is missing.
 */
export function parseTournamentIndex(
  values: unknown[][],
): TournamentIndexRow[] {
  const header = (values[0] ?? []).map(cell => cellText(cell));
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index === -1) {
      throw new TournamentIndexError(
        `1行目に「${name}」の列が見つかりません。大会一覧のシートが先頭にあるか確認してください`,
      );
    }
    return index;
  };
  const columns = {
    region: column(HEADERS.region),
    type: column(HEADERS.type),
    eventDate: column(HEADERS.eventDate),
    spreadsheetId: column(HEADERS.spreadsheetId),
  };

  const rows: TournamentIndexRow[] = [];
  values.slice(1).forEach((cells, index) => {
    const row: TournamentIndexRow = {
      row: index + 2,
      regionName: cellText(cells[columns.region]),
      typeLabel: cellText(cells[columns.type]),
      eventDate: cellText(cells[columns.eventDate]),
      spreadsheetId: cellText(cells[columns.spreadsheetId]),
    };
    if (
      [row.regionName, row.typeLabel, row.eventDate, row.spreadsheetId].every(
        text => text === '',
      )
    ) {
      return;
    }
    rows.push(row);
  });
  return rows;
}

/**
 * When entry for a tournament held on `eventDate` closes by default: 23:59
 * JST on the day before (#168).
 * @param eventDate The 実施日 cell, e.g. `2026/12/26（土）`.
 * @return The instant as an ISO string, or `null` if the cell isn't a date.
 */
export function defaultEntryClosesAt(eventDate: string): string | null {
  const match = EVENT_DATE_PATTERN.exec(eventDate.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` rolls 2026/2/30 over into March rather than refusing it.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  // The day before, at 23:59 JST: day - 1 in UTC terms, 9 hours earlier.
  return new Date(
    Date.UTC(year, month - 1, day - 1, 23 - JST_OFFSET_HOURS, 59),
  ).toISOString();
}

/**
 * Registers every tournament on the 大会一覧 spreadsheet `spreadsheetId`.
 * @param env The Worker bindings.
 * @param spreadsheetId The 大会一覧 spreadsheet.
 * @param now The moment entry opens for every tournament registered.
 * @return One result per row, in sheet order.
 * @throws {SheetFetchError} If the 大会一覧 sheet can't be read.
 * @throws {TournamentIndexError} If it lacks one of the columns.
 * @throws {Error} If the regions can't be read.
 */
export async function importTournaments(
  env: Bindings,
  spreadsheetId: string,
  now: Date,
): Promise<TournamentImportResult[]> {
  const rows = parseTournamentIndex(
    await fetchSheetValues(
      spreadsheetId,
      INDEX_RANGE,
      env.GOOGLE_SHEETS_API_KEY,
    ),
  );

  const {data: regions, error} = await createDbClient(env)
    .from('regions')
    .select('id, name')
    .returns<Array<{id: string; name: string}>>();
  if (error) {
    throw new Error(`failed to read the regions: ${error.message}`);
  }
  // Names aren't unique in `regions`, so a name may stand for several; such
  // a row can't be told which region it means and is refused in `importRow`.
  const regionIds = new Map<string, string[]>();
  for (const region of regions) {
    regionIds.set(region.name, [
      ...(regionIds.get(region.name) ?? []),
      region.id,
    ]);
  }

  // Two rows for one region and type would overwrite each other in sheet
  // order, and which of them was meant can't be told, so neither is
  // registered.
  const rowsByTournament = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.regionName}\u0000${row.typeLabel}`;
    rowsByTournament.set(key, [...(rowsByTournament.get(key) ?? []), row.row]);
  }
  const duplicateOf = (row: TournamentIndexRow) =>
    (
      rowsByTournament.get(`${row.regionName}\u0000${row.typeLabel}`) ?? []
    ).filter(other => other !== row.row);

  return mapWithConcurrency(rows, CONCURRENCY, row => {
    const others = duplicateOf(row);
    if (others.length > 0) {
      return Promise.resolve(
        failed(
          row,
          `同じ地域・種別の大会が${others.map(n => `${n}行目`).join('・')}にもあります`,
        ),
      );
    }
    return importRow(env, row, regionIds, now);
  });
}

/**
 * Registers the tournament one row of the 大会一覧 sheet describes.
 * @param env The Worker bindings.
 * @param row The row.
 * @param regionIds The ids of the regions of each name.
 * @param now The moment entry opens.
 */
async function importRow(
  env: Bindings,
  row: TournamentIndexRow,
  regionIds: Map<string, string[]>,
  now: Date,
): Promise<TournamentImportResult> {
  const candidates = regionIds.get(row.regionName) ?? [];
  if (candidates.length === 0) {
    return failed(
      row,
      `地域「${row.regionName}」が登録されていません。地域の画面で名前を確認してください`,
    );
  }
  if (candidates.length > 1) {
    return failed(
      row,
      `「${row.regionName}」という名前の地域が複数あるため、どれか決められません`,
    );
  }
  const [regionId] = candidates;
  const type = TYPES_BY_LABEL.get(row.typeLabel);
  if (type === undefined) {
    return failed(
      row,
      `種別「${row.typeLabel}」は${[...TYPES_BY_LABEL.keys()].join('・')}のいずれでもありません`,
    );
  }
  const entryClosesAt = defaultEntryClosesAt(row.eventDate);
  if (entryClosesAt === null) {
    return failed(
      row,
      `実施日「${row.eventDate}」を日付として読み取れません(例: 2026/12/26)`,
    );
  }
  const entryOpensAt = now.toISOString();
  if (Date.parse(entryClosesAt) <= now.getTime()) {
    return failed(
      row,
      'エントリーの締切(実施日の前日 23:59)が既に過ぎています',
    );
  }
  if (row.spreadsheetId === '') {
    return failed(row, 'スプレッドシートIDが空です');
  }

  let formFields: Array<Record<string, unknown>>;
  let regulations: unknown;
  try {
    // One request for both tabs (see `fetchSheetBatch()`). Unformatted so
    // a date-time cell on the regulation tab arrives as a serial number,
    // which is what `sheetValuesToRegulations()` reads.
    const [formValues, regulationValues] = await fetchSheetBatch(
      row.spreadsheetId,
      [FORM_DEFINITION_RANGE, `'${REGULATION_SHEET_NAME}'!A2:C`],
      env.GOOGLE_SHEETS_API_KEY,
      {
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      },
    );
    formFields = formFieldDefSyncRows(
      parseFormDefinitionYaml(
        sheetRowsToYaml(type, sheetValuesToRows(formValues)),
      ),
    );
    regulations = sheetValuesToRegulations(regulationValues);
  } catch (e: unknown) {
    if (e instanceof SheetFetchError && e.status === 400) {
      return failed(
        row,
        `入力シートを読み取れません。スプレッドシートIDと、「${REGULATION_SHEET_NAME}」シートがあるかを確認してください`,
      );
    }
    return failed(row, `入力シート: ${classifySheetImportError(e).error}`);
  }

  const {data, error} = await createDbClient(env)
    .rpc('import_tournament', {
      p_region_id: regionId,
      p_type: type,
      p_entry_opens_at: entryOpensAt,
      p_entry_closes_at: entryClosesAt,
      p_form_fields: formFields,
      p_regulations: regulations,
    })
    .returns<Array<{tournament_id: string; created: boolean}>>()
    .single();
  if (error) {
    // A regulation still in use is something staff can act on: put the
    // regulation back on the sheet, or register the tournament by hand.
    const syncError = regulationSyncError(error, '');
    if (
      syncError instanceof RegulationInUseError ||
      syncError instanceof UnknownRegulationError
    ) {
      return failed(row, syncError.message);
    }
    console.error('failed to import a tournament', {
      row: row.row,
      error: error.message,
    });
    return failed(row, '登録に失敗しました。時間をおいて再度お試しください');
  }
  return {
    row: row.row,
    regionName: row.regionName,
    typeLabel: row.typeLabel,
    outcome: data.created ? 'created' : 'updated',
    tournamentId: data.tournament_id,
    type,
    entryOpensAt,
    entryClosesAt,
    error: null,
  };
}

/** The result for a row that was not registered. */
function failed(
  row: TournamentIndexRow,
  error: string,
): TournamentImportResult {
  return {
    row: row.row,
    regionName: row.regionName,
    typeLabel: row.typeLabel,
    outcome: 'failed',
    tournamentId: null,
    type: null,
    entryOpensAt: null,
    entryClosesAt: null,
    error,
  };
}

/** A cell as trimmed text; empty for a cell the API left out. */
function cellText(cell: unknown): string {
  return cell === undefined || cell === null ? '' : String(cell).trim();
}

/**
 * `Promise.all(items.map(fn))`, with at most `limit` of the calls in flight
 * at once. The results keep `items`' order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({length: Math.min(limit, items.length)}, worker),
  );
  return results;
}
