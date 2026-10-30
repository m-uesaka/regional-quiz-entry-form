// Registers the tournaments listed on a 大会一覧 spreadsheet (#168).
//
// Each row of the sheet names a region, a tournament type, its capacity and
// entry period, and the region staff's own entry-form spreadsheet -- the
// same one the edit screen imports a form definition and regulations from
// (`docs/google-sheets-integration.md`).
//
// Registering is two steps. `previewTournamentImport()` reads everything
// and writes nothing: per row, whether it would create a tournament or
// overwrite the one already there (with what that one holds now), or why
// it can't be registered. Staff then choose, tournament by tournament, what
// to go ahead with, and `importTournaments()` reads the sheets again and
// registers only those. A row is registered as a whole (the tournament, its
// form definition and its regulations) by `import_tournament()` in one
// transaction, or not at all: a row that fails anywhere is reported back
// with the reason, while the rest go ahead.
import {ZodError} from 'zod';
import {
  defaultTournamentName,
  parseFormDefinitionYaml,
  REGULATION_SHEET_NAME,
  spreadsheetIdFromInput,
  TOURNAMENT_TYPE_LABELS,
  TournamentTypeSchema,
  type FormFieldDefYaml,
  type RegulationUpsert,
  type TournamentImportAction,
  type TournamentImportCurrent,
  type TournamentImportPreviewRow,
  type TournamentImportResult,
  type TournamentImportSelection,
  type TournamentType,
  type WaitlistPromotion,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {formFieldDefSyncRows} from './form-definitions';
import {JST_OFFSET_MS} from './jst';
import {regulationSyncFailure} from './regulations';
import {classifySheetImportError} from './sheet-import-errors';
import {
  DuplicateOptionError,
  fetchEntrySheet,
  fetchSheetValues,
  SheetFetchError,
  sheetRowsToYaml,
  sheetValuesToRows,
  TYPE_LABELS,
  UnknownFieldTypeError,
  type SheetRow,
} from './sheet-to-form-definition';
import {sheetValuesToRegulations} from './sheet-to-regulations';
import {promoteWaitlistedEntries} from './waitlist';

/** The headers of the 大会一覧 sheet's columns this reads. */
const HEADERS = {
  region: '地域',
  type: '種別',
  capacity: '定員',
  entryOpensAt: 'エントリー開始',
  entryClosesAt: 'エントリー終了',
  spreadsheetId: 'スプレッドシートID',
} as const;

// The 大会一覧 sheet is the first tab. The whole width is read so the
// columns can be found by their headers rather than by position: the sheet
// carries other columns (the day the tournament is held, the spreadsheet's
// name and URL) that may move.
const INDEX_RANGE = 'A1:Z';

// How many tournaments are fetched and written at once. Every row costs one
// Sheets request and one database call, so this bounds how hard a long list
// hits either, while still finishing a few dozen rows in seconds rather
// than one round trip after another.
const CONCURRENCY = 4;

// `2026/11/04 21:00:00`, `2026/10/31 0:00`, `2026-10-31 21:00`: the sheet's
// date-time as displayed, read as Japan time. The time is required -- a bare
// date would leave it open whether entry closes at the start or the end of
// that day.
const DATE_TIME_PATTERN =
  /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

// `54`, `1,000`, `54人`. Blank is "no capacity".
const CAPACITY_PATTERN = /^(\d[\d,]*)人?$/;

/**
 * Raised by `import_tournament()` (0036) when the tournament has been
 * created (for `create`) or deleted (for `overwrite`) since the preview.
 */
const IMPORT_ACTION_STALE_SQLSTATE = 'P0006';

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
  capacity: string;
  entryOpensAt: string;
  entryClosesAt: string;
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
    capacity: column(HEADERS.capacity),
    entryOpensAt: column(HEADERS.entryOpensAt),
    entryClosesAt: column(HEADERS.entryClosesAt),
    spreadsheetId: column(HEADERS.spreadsheetId),
  };

  const rows: TournamentIndexRow[] = [];
  values.slice(1).forEach((cells, index) => {
    const row: TournamentIndexRow = {
      row: index + 2,
      regionName: cellText(cells[columns.region]),
      typeLabel: cellText(cells[columns.type]),
      capacity: cellText(cells[columns.capacity]),
      entryOpensAt: cellText(cells[columns.entryOpensAt]),
      entryClosesAt: cellText(cells[columns.entryClosesAt]),
      spreadsheetId: cellText(cells[columns.spreadsheetId]),
    };
    if (
      [
        row.regionName,
        row.typeLabel,
        row.capacity,
        row.entryOpensAt,
        row.entryClosesAt,
        row.spreadsheetId,
      ].every(text => text === '')
    ) {
      return;
    }
    rows.push(row);
  });
  return rows;
}

/**
 * Reads an エントリー開始 / エントリー終了 cell as a Japan-time instant.
 * @param cell The cell as displayed, e.g. `2026/11/04 21:00:00`.
 * @return The instant as an ISO string, or `null` if the cell isn't a
 *     date and time.
 */
export function parseJstDateTime(cell: string): string | null {
  const match = DATE_TIME_PATTERN.exec(cell.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` rolls 2026/2/30 over into March rather than refusing it.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  // That wall-clock time in Japan, 9 hours earlier in UTC.
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - JST_OFFSET_MS,
  ).toISOString();
}

/**
 * Reads a 定員 cell.
 * @param cell The cell as displayed.
 * @return The capacity, `null` for a blank cell (no capacity), or
 *     `undefined` if the cell isn't a positive whole number.
 */
export function parseCapacity(cell: string): number | null | undefined {
  if (cell === '') return null;
  const match = CAPACITY_PATTERN.exec(cell);
  if (!match) return undefined;
  const capacity = Number(match[1].replaceAll(',', ''));
  return Number.isSafeInteger(capacity) && capacity > 0 ? capacity : undefined;
}

/** A row read and checked in full, ready to be written. */
interface PreparedRow {
  regionId: string;
  type: TournamentType;
  capacity: number | null;
  entryOpensAt: string;
  entryClosesAt: string;
  formFields: Array<Record<string, unknown>>;
  formFieldLabels: string[];
  regulations: RegulationUpsert[];
}

/** What every run needs besides the rows: the regions and tournaments. */
interface ImportContext {
  env: Bindings;
  db: ReturnType<typeof createDbClient>;
  /** The ids of the regions of each name. */
  regionIds: Map<string, string[]>;
  /** The tournaments there are, by `tournamentKey()`. */
  tournaments: Map<string, TournamentImportCurrent>;
  now: Date;
}

/**
 * Says, for every row on the 大会一覧 spreadsheet `spreadsheetId`, what
 * registering it would do, reading every row's entry sheet so a mistake on
 * one shows up now rather than when it is registered. Writes nothing.
 * @param env The Worker bindings.
 * @param spreadsheetId The 大会一覧 spreadsheet.
 * @param now The present, which entry must not have closed by.
 * @return One row per row of the sheet, in sheet order.
 * @throws {SheetFetchError} If the 大会一覧 sheet can't be read.
 * @throws {TournamentIndexError} If it lacks one of the columns.
 * @throws {Error} If the regions or tournaments can't be read.
 */
export async function previewTournamentImport(
  env: Bindings,
  spreadsheetId: string,
  now: Date,
): Promise<TournamentImportPreviewRow[]> {
  const {rows, context, duplicateOf} = await startRun(env, spreadsheetId, now);

  return mapWithConcurrency(rows, CONCURRENCY, async row => {
    const resolved = await resolveRow(context, row, duplicateOf, 'preview');
    if ('error' in resolved) {
      return {
        row: row.row,
        regionName: row.regionName,
        typeLabel: row.typeLabel,
        action: null,
        fingerprint: null,
        error: resolved.error,
        capacity: null,
        entryOpensAt: null,
        entryClosesAt: null,
        formFieldLabels: [],
        regulationLabels: [],
        current: null,
      };
    }
    const {prepared, current, fingerprint} = resolved;
    return {
      row: row.row,
      regionName: row.regionName,
      typeLabel: row.typeLabel,
      action: current === null ? 'create' : 'overwrite',
      fingerprint,
      error: null,
      capacity: prepared.capacity,
      entryOpensAt: prepared.entryOpensAt,
      entryClosesAt: prepared.entryClosesAt,
      formFieldLabels: prepared.formFieldLabels,
      regulationLabels: prepared.regulations.map(r => r.label),
      current,
    };
  });
}

/**
 * Registers the tournaments staff chose from the 大会一覧 spreadsheet
 * `spreadsheetId`, reading it again. A tournament is written only if what
 * would be written, and the tournament it would overwrite, are still what
 * the preview showed (its `fingerprint`); otherwise it fails and staff
 * read the sheet again.
 * @param env The Worker bindings.
 * @param spreadsheetId The 大会一覧 spreadsheet.
 * @param selections The rows to register and what to do with each, as the
 *     preview offered.
 * @param now The present, which entry must not have closed by.
 * @return One result per selection, in the order given.
 * @throws {SheetFetchError} If the 大会一覧 sheet can't be read.
 * @throws {TournamentIndexError} If it lacks one of the columns.
 * @throws {Error} If the regions or tournaments can't be read.
 */
export async function importTournaments(
  env: Bindings,
  spreadsheetId: string,
  selections: TournamentImportSelection[],
  now: Date,
): Promise<TournamentImportResult[]> {
  const {rows, context, duplicateOf} = await startRun(env, spreadsheetId, now);

  return mapWithConcurrency(selections, CONCURRENCY, async selection => {
    const row = rows.find(
      candidate =>
        candidate.regionName === selection.regionName &&
        candidate.typeLabel === selection.typeLabel,
    );
    if (row === undefined) {
      return failed(
        null,
        selection,
        '大会一覧にこの地域・種別の行が見つかりません。もう一度読み込んでください',
      );
    }
    // Whatever goes wrong with one row stays that row's failure. Letting it
    // reject would fail the whole request and lose the results of the rows
    // already committed, so staff would re-run them without knowing they
    // had gone through.
    try {
      const resolved = await resolveRow(context, row, duplicateOf, 'import');
      if ('error' in resolved) {
        return failed(row.row, row, resolved.error);
      }
      if (resolved.fingerprint !== selection.fingerprint) {
        return failed(
          row.row,
          row,
          '読み込んだ後に、シートまたは登録済みの大会の内容が変わりました。もう一度読み込んで確認してください',
        );
      }
      return await importRow(
        context,
        row,
        resolved.prepared,
        selection.action,
        resolved.current?.name,
      );
    } catch (e: unknown) {
      console.error('failed to import a tournament', {row: row.row, error: e});
      return failed(
        row.row,
        selection,
        '登録に失敗しました。時間をおいて再度お試しください',
      );
    }
  });
}

/** Reads the 大会一覧 sheet and what both steps check its rows against. */
async function startRun(env: Bindings, spreadsheetId: string, now: Date) {
  const rows = await readIndex(env, spreadsheetId);
  const context = await loadContext(env, now);
  return {rows, context, duplicateOf: duplicateFinder(rows)};
}

/** A row ready to write, with what it is checked against on execute. */
interface ResolvedRow {
  prepared: PreparedRow;
  /** The tournament it would overwrite, or null for a new one. */
  current: TournamentImportCurrent | null;
  fingerprint: string;
}

/**
 * Reads and checks one row the same way for the preview and for the
 * registration, so the preview can't approve a row the registration then
 * refuses for some other reason, or the reverse.
 * @param context The regions and tournaments.
 * @param row The row.
 * @param duplicateOf Finds the other rows for the same region and type.
 * @param step Which step this is, for the log.
 * @return The row ready to write, or why it can't be registered.
 */
async function resolveRow(
  context: ImportContext,
  row: TournamentIndexRow,
  duplicateOf: (row: TournamentIndexRow) => number[],
  step: 'preview' | 'import',
): Promise<ResolvedRow | {error: string}> {
  const others = duplicateOf(row);
  if (others.length > 0) {
    return {error: duplicateMessage(others)};
  }
  let prepared;
  try {
    prepared = await prepareRow(context, row);
  } catch (e: unknown) {
    console.error(`failed to read a tournament to ${step}`, {
      row: row.row,
      error: e,
    });
    return {error: '読み込みに失敗しました。時間をおいて再度お試しください'};
  }
  if (typeof prepared === 'string') {
    return {error: prepared};
  }
  const current =
    context.tournaments.get(tournamentKey(prepared.regionId, prepared.type)) ??
    null;
  return {
    prepared,
    current,
    fingerprint: await fingerprintOf(prepared, current),
  };
}

/**
 * A digest of everything registering a row would write and of the
 * tournament it would overwrite. The preview hands it out and the
 * registration recomputes it, so a sheet edited, or a tournament changed on
 * its own screen, in between is noticed instead of written unseen.
 */
async function fingerprintOf(
  prepared: PreparedRow,
  current: TournamentImportCurrent | null,
): Promise<string> {
  const text = JSON.stringify([
    prepared.regionId,
    prepared.type,
    prepared.capacity,
    prepared.entryOpensAt,
    prepared.entryClosesAt,
    prepared.formFields,
    prepared.regulations,
    current,
  ]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Reads the 大会一覧 sheet's rows. */
async function readIndex(
  env: Bindings,
  spreadsheetId: string,
): Promise<TournamentIndexRow[]> {
  return parseTournamentIndex(
    await fetchSheetValues(
      spreadsheetId,
      INDEX_RANGE,
      env.GOOGLE_SHEETS_API_KEY,
    ),
  );
}

/** Reads the regions and the tournaments there are now. */
async function loadContext(env: Bindings, now: Date): Promise<ImportContext> {
  // One client for the whole run rather than one per row.
  const db = createDbClient(env);
  const [regionsRead, tournamentsRead] = await Promise.all([
    db
      .from('regions')
      .select('id, name')
      .returns<Array<{id: string; name: string}>>(),
    db
      .from('tournaments')
      .select(
        'id, region_id, type, name, capacity, entry_opens_at, entry_closes_at',
      )
      .returns<
        Array<{
          id: string;
          region_id: string;
          type: TournamentType;
          name: string | null;
          capacity: number | null;
          entry_opens_at: string;
          entry_closes_at: string;
        }>
      >(),
  ]);
  if (regionsRead.error) {
    throw new Error(`failed to read the regions: ${regionsRead.error.message}`);
  }
  if (tournamentsRead.error) {
    throw new Error(
      `failed to read the tournaments: ${tournamentsRead.error.message}`,
    );
  }
  // Names aren't unique in `regions`, so a name may stand for several; such
  // a row can't be told which region it means and is refused in
  // `prepareRow()`.
  const regionIds = new Map<string, string[]>();
  const regionNames = new Map<string, string>();
  for (const region of regionsRead.data) {
    regionIds.set(region.name, [
      ...(regionIds.get(region.name) ?? []),
      region.id,
    ]);
    regionNames.set(region.id, region.name);
  }
  const tournaments = new Map<string, TournamentImportCurrent>();
  for (const t of tournamentsRead.data) {
    tournaments.set(tournamentKey(t.region_id, t.type), {
      tournamentId: t.id,
      name:
        t.name ??
        defaultTournamentName(regionNames.get(t.region_id) ?? '', t.type),
      capacity: t.capacity,
      entryOpensAt: new Date(t.entry_opens_at).toISOString(),
      entryClosesAt: new Date(t.entry_closes_at).toISOString(),
    });
  }
  return {env, db, regionIds, tournaments, now};
}

/**
 * Two rows for one region and type would overwrite each other, and which
 * of them was meant can't be told, so neither is registered. The returned
 * function gives the other rows a row shares its region and type with.
 */
function duplicateFinder(
  rows: TournamentIndexRow[],
): (row: TournamentIndexRow) => number[] {
  const rowsByTournament = new Map<string, number[]>();
  const key = (row: TournamentIndexRow) =>
    `${row.regionName}\u0000${row.typeLabel}`;
  for (const row of rows) {
    rowsByTournament.set(key(row), [
      ...(rowsByTournament.get(key(row)) ?? []),
      row.row,
    ]);
  }
  return row =>
    (rowsByTournament.get(key(row)) ?? []).filter(other => other !== row.row);
}

function duplicateMessage(others: number[]): string {
  return `同じ地域・種別の大会が${others.map(n => `${n}行目`).join('・')}にもあります`;
}

function tournamentKey(regionId: string, type: TournamentType): string {
  return `${regionId}\u0000${type}`;
}

/**
 * Reads and checks one row of the 大会一覧 sheet and its entry sheet.
 * @return The row ready to write, or why it can't be registered.
 */
async function prepareRow(
  context: ImportContext,
  row: TournamentIndexRow,
): Promise<PreparedRow | string> {
  const candidates = context.regionIds.get(row.regionName) ?? [];
  if (candidates.length === 0) {
    return `地域「${row.regionName}」が登録されていません。地域の画面で名前を確認してください`;
  }
  if (candidates.length > 1) {
    return `「${row.regionName}」という名前の地域が複数あるため、どれか決められません`;
  }
  const [regionId] = candidates;
  const type = TYPES_BY_LABEL.get(row.typeLabel);
  if (type === undefined) {
    return `種別「${row.typeLabel}」は${[...TYPES_BY_LABEL.keys()].join('・')}のいずれでもありません`;
  }
  const capacity = parseCapacity(row.capacity);
  if (capacity === undefined) {
    return `定員「${row.capacity}」は 1 以上の整数にしてください(定員なしの場合は空欄)`;
  }
  const entryOpensAt = parseJstDateTime(row.entryOpensAt);
  if (entryOpensAt === null) {
    return `エントリー開始「${row.entryOpensAt}」を日時として読み取れません(例: 2026/11/04 21:00:00)`;
  }
  const entryClosesAt = parseJstDateTime(row.entryClosesAt);
  if (entryClosesAt === null) {
    return `エントリー終了「${row.entryClosesAt}」を日時として読み取れません(例: 2026/12/16 23:59:59)`;
  }
  if (Date.parse(entryOpensAt) >= Date.parse(entryClosesAt)) {
    return 'エントリー開始がエントリー終了より後になっています';
  }
  if (Date.parse(entryClosesAt) <= context.now.getTime()) {
    return 'エントリー終了が既に過ぎています';
  }
  // The column may well hold the sheet's URL rather than its ID, as the
  // import form itself accepts either.
  const spreadsheetId = spreadsheetIdFromInput(row.spreadsheetId);
  if (spreadsheetId === '') {
    return 'スプレッドシートIDが空です';
  }

  try {
    // One request for both tabs, the form tab as displayed and the
    // regulation tab unformatted (see `fetchEntrySheet()`).
    const {formValues, regulationValues} = await fetchEntrySheet(
      spreadsheetId,
      context.env.GOOGLE_SHEETS_API_KEY,
      REGULATION_SHEET_NAME,
    );
    const fields = formRowsToFields(type, sheetValuesToRows(formValues));
    return {
      regionId,
      type,
      capacity,
      entryOpensAt,
      entryClosesAt,
      formFields: formFieldDefSyncRows({tournamentSlug: type, fields}),
      formFieldLabels: fields.map(field => field.label),
      regulations: sheetValuesToRegulations(regulationValues),
    };
  } catch (e: unknown) {
    if (e instanceof FormSheetError) {
      return e.message;
    }
    if (e instanceof SheetFetchError && e.status === 400) {
      return `入力シートを読み取れません。スプレッドシートIDと、「${REGULATION_SHEET_NAME}」シートがあるかを確認してください`;
    }
    // The regulation tab's own errors already name the row in Japanese.
    return `レギュレーション: ${classifySheetImportError(e).error}`;
  }
}

/**
 * Registers the tournament one row of the 大会一覧 sheet describes.
 * @param context The regions and tournaments, and the client to write with.
 * @param row The row.
 * @param prepared The row, read and checked.
 * @param action What staff chose to do with it.
 * @param currentName The display name of the tournament it overwrites.
 */
async function importRow(
  context: ImportContext,
  row: TournamentIndexRow,
  prepared: PreparedRow,
  action: TournamentImportAction,
  currentName: string | undefined,
): Promise<TournamentImportResult> {
  const {data, error} = await context.db
    .rpc('import_tournament', {
      p_region_id: prepared.regionId,
      p_type: prepared.type,
      p_overwrite: action === 'overwrite',
      p_capacity: prepared.capacity,
      p_entry_opens_at: prepared.entryOpensAt,
      p_entry_closes_at: prepared.entryClosesAt,
      p_form_fields: prepared.formFields,
      p_regulations: prepared.regulations,
    })
    .returns<Array<{tournament_id: string; created: boolean}>>()
    .single();
  if (error) {
    if (error.code === IMPORT_ACTION_STALE_SQLSTATE) {
      return failed(
        row.row,
        row,
        action === 'create'
          ? '読み込んだ後に、この大会が別の操作で登録されました。もう一度読み込んで、上書きするか選んでください'
          : '読み込んだ後に、この大会が別の操作で削除されました。もう一度読み込んでください',
      );
    }
    // A regulation still in use is something staff can act on: put the
    // regulation back on the sheet, or register the tournament by hand.
    const syncFailure = regulationSyncFailure(error);
    if (syncFailure) {
      return failed(row.row, row, syncFailure.message);
    }
    console.error('failed to import a tournament', {
      row: row.row,
      error: error.message,
    });
    return failed(
      row.row,
      row,
      '登録に失敗しました。時間をおいて再度お試しください',
    );
  }
  // An overwrite may have raised or cleared the capacity of a tournament
  // with a waitlist (#223). A new tournament has no entries to promote. The
  // tournament is committed by now, so a failed promotion doesn't fail the
  // row; saving the capacity again on the edit screen retries it.
  let promotion: WaitlistPromotion | null = {
    promotedCount: 0,
    mailFailedCount: 0,
  };
  if (!data.created) {
    try {
      promotion = await promoteWaitlistedEntries(
        context.env,
        data.tournament_id,
        // An overwrite leaves the name as it was, so the one read for the
        // preview is still the one to mail under.
        {db: context.db, tournamentName: currentName},
      );
    } catch (e: unknown) {
      console.error('failed to promote waitlisted entries', {
        row: row.row,
        error: e,
      });
      promotion = null;
    }
  }
  return {
    row: row.row,
    regionName: row.regionName,
    typeLabel: row.typeLabel,
    outcome: data.created ? 'created' : 'updated',
    tournamentId: data.tournament_id,
    type: prepared.type,
    capacity: prepared.capacity,
    entryOpensAt: prepared.entryOpensAt,
    entryClosesAt: prepared.entryClosesAt,
    error: null,
    promotion,
  };
}

/**
 * A mistake on the form-definition tab of a row's entry sheet, worded for
 * staff and naming the sheet row it is on.
 */
class FormSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormSheetError';
  }
}

// What each column of the form tab is called in a message.
const FORM_COLUMN_NAMES: Record<string, string> = {
  key: 'A列(key)',
  label: 'B列(label)',
  type: 'C列(type)',
  required: 'D列(required)',
  options: 'E列(options)',
};

/**
 * The fields the form tab defines, checked one row at a time so a mistake
 * is reported with its sheet row in Japanese rather than as the converter's
 * English message or a dump of Zod issues.
 * @param type The tournament's type.
 * @param rows The form tab's rows, from row 2.
 * @throws {FormSheetError} For the first row that is wrong, or for a key
 *     used twice.
 */
function formRowsToFields(
  type: TournamentType,
  rows: SheetRow[],
): FormFieldDefYaml[] {
  const fields = rows.map((row, index) => {
    const at = `フォーム定義 ${index + 2}行目`;
    try {
      // `sheetRowsToYaml()` is the conversion the edit screen's import uses,
      // so both read a sheet the same way; it is run per row here only to
      // know which row a failure belongs to.
      const [field] = parseFormDefinitionYaml(
        sheetRowsToYaml(type, [row]),
      ).fields;
      return field;
    } catch (e: unknown) {
      if (e instanceof UnknownFieldTypeError) {
        throw new FormSheetError(
          e.label === undefined || e.label === ''
            ? `${at}: C列(type)が空です。途中に空行がある場合は行を詰めてください`
            : `${at}: C列(type)「${e.label}」は${Object.keys(TYPE_LABELS).join('・')}のいずれでもありません`,
        );
      }
      if (e instanceof DuplicateOptionError) {
        throw new FormSheetError(
          `${at}: E列(options)に同じ選択肢が複数あります`,
        );
      }
      if (e instanceof ZodError) {
        const column = String(e.issues[0]?.path[0] ?? '');
        if (column === 'key') {
          throw new FormSheetError(
            `${at}: A列(key)「${row.key ?? ''}」は小文字の英字で始まり、小文字の英数字と _ だけにしてください`,
          );
        }
        if (column === 'options') {
          throw new FormSheetError(
            `${at}: ラジオボタンには E列(options)に選択肢が1つ以上必要です`,
          );
        }
        throw new FormSheetError(
          `${at}: ${FORM_COLUMN_NAMES[column] ?? column}の値が正しくありません`,
        );
      }
      throw e;
    }
  });
  const keys = fields.map(field => field.key);
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate !== undefined) {
    throw new FormSheetError(
      `フォーム定義: A列(key)「${duplicate}」が複数の行で使われています`,
    );
  }
  return fields;
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

/** The result for a row that was not registered. */
function failed(
  row: number | null,
  names: {regionName: string; typeLabel: string},
  error: string,
): TournamentImportResult {
  return {
    row,
    regionName: names.regionName,
    typeLabel: names.typeLabel,
    outcome: 'failed',
    tournamentId: null,
    type: null,
    capacity: null,
    entryOpensAt: null,
    entryClosesAt: null,
    error,
    promotion: {promotedCount: 0, mailFailedCount: 0},
  };
}
