import {afterEach, describe, expect, it} from 'bun:test';
import {SheetFetchError} from './sheet-to-form-definition';
import {
  fetchRegulationSheetValues,
  sheetValuesToRegulations,
} from './sheet-to-regulations';

// 2026-08-01 as a Sheets date serial (days since 1899-12-30).
const AUG_1_2026 = 46235;

describe('sheetValuesToRegulations', () => {
  it('reads labels in sheet order, with no priority window when blank', () => {
    expect(
      sheetValuesToRegulations([['一般の部'], ['学生の部', '', '']]),
    ).toEqual([
      {label: '一般の部', priorityStartsAt: null, priorityEndsAt: null},
      {label: '学生の部', priorityStartsAt: null, priorityEndsAt: null},
    ]);
  });

  it('reads a date serial as JST wall-clock time', () => {
    // 10:00 and 18:30 on the day, as fractions of it.
    const [regulation] = sheetValuesToRegulations([
      ['地元の部', AUG_1_2026 + 10 / 24, AUG_1_2026 + 18.5 / 24],
    ]);

    expect(regulation.priorityStartsAt).toBe('2026-08-01T01:00:00.000Z');
    expect(regulation.priorityEndsAt).toBe('2026-08-01T09:30:00.000Z');
  });

  it('reads a date-time typed as text as JST wall-clock time', () => {
    const [regulation] = sheetValuesToRegulations([
      ['地元の部', '2026-08-01 10:00', '2026/8/7'],
    ]);

    expect(regulation.priorityStartsAt).toBe('2026-08-01T01:00:00.000Z');
    // A bare date is midnight JST.
    expect(regulation.priorityEndsAt).toBe('2026-08-06T15:00:00.000Z');
  });

  it('skips rows with nothing in them', () => {
    expect(
      sheetValuesToRegulations([['一般の部'], [], ['', ' '], ['学生の部']]).map(
        regulation => regulation.label,
      ),
    ).toEqual(['一般の部', '学生の部']);
  });

  it('trims the label and stringifies a numeric one', () => {
    expect(
      sheetValuesToRegulations([[' 一般の部 '], [2026]]).map(
        regulation => regulation.label,
      ),
    ).toEqual(['一般の部', '2026']);
  });

  it('refuses a row with a window but no label, naming the sheet row', () => {
    expect(() =>
      sheetValuesToRegulations([
        ['一般の部'],
        ['', AUG_1_2026, AUG_1_2026 + 1],
      ]),
    ).toThrow('3行目: レギュレーション名が空です');
  });

  it('refuses a repeated label', () => {
    expect(() =>
      sheetValuesToRegulations([['一般の部'], ['一般の部']]),
    ).toThrow('3行目: レギュレーション名が重複しています: 一般の部');
  });

  it('refuses a cell that is not a date-time', () => {
    expect(() =>
      sheetValuesToRegulations([['地元の部', '8月1日', AUG_1_2026]]),
    ).toThrow('2行目: 優先期間の開始を日時として読み取れません');
    // A date that doesn't exist is refused rather than rolled over.
    expect(() =>
      sheetValuesToRegulations([['地元の部', AUG_1_2026, '2026-02-30']]),
    ).toThrow('2行目: 優先期間の終了を日時として読み取れません');
    // A stray small number is not taken for a date in 1905.
    expect(() =>
      sheetValuesToRegulations([['地元の部', 2026, AUG_1_2026]]),
    ).toThrow('2行目: 優先期間の開始を日時として読み取れません');
  });

  it('refuses a half-filled window, naming the sheet row', () => {
    expect(() =>
      sheetValuesToRegulations([['一般の部'], [], ['地元の部', AUG_1_2026]]),
    ).toThrow('4行目: 優先期間は開始と終了の両方を指定してください');
  });

  it('refuses a window that ends before it starts', () => {
    expect(() =>
      sheetValuesToRegulations([['地元の部', AUG_1_2026 + 1, AUG_1_2026]]),
    ).toThrow('2行目: 優先期間の終了は開始より後にしてください');
  });

  it('refuses a sheet with no regulations', () => {
    expect(() => sheetValuesToRegulations([])).toThrow(
      '「レギュレーション」シートにレギュレーションが1件もありません',
    );
  });
});

describe('fetchRegulationSheetValues', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads A2:C of the regulation tab, unformatted', async () => {
    let requested = '';
    globalThis.fetch = ((input: string) => {
      requested = input;
      return Promise.resolve(
        new Response(JSON.stringify({values: [['一般の部']]}), {status: 200}),
      );
    }) as unknown as typeof fetch;

    await expect(
      fetchRegulationSheetValues('sheet-id', 'key'),
    ).resolves.toEqual([['一般の部']]);

    const url = new URL(requested);
    expect(decodeURIComponent(url.pathname)).toBe(
      "/v4/spreadsheets/sheet-id/values/'レギュレーション'!A2:C",
    );
    expect(url.searchParams.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
    expect(url.searchParams.get('dateTimeRenderOption')).toBe('SERIAL_NUMBER');
    expect(url.searchParams.get('key')).toBe('key');
  });

  it('says the tab could not be read when Google answers 400', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 400}),
      )) as unknown as typeof fetch;

    const error = await fetchRegulationSheetValues('sheet-id', 'key').catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(SheetFetchError);
    expect((error as SheetFetchError).status).toBe(400);
    expect((error as SheetFetchError).message).toContain(
      '「レギュレーション」シートを読み取れません',
    );
  });

  it('passes other failures through untouched', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 403}),
      )) as unknown as typeof fetch;

    await expect(fetchRegulationSheetValues('sheet-id', 'key')).rejects.toThrow(
      'Failed to fetch sheet: 403',
    );
  });
});
