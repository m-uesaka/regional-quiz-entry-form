import {afterEach, describe, expect, it} from 'bun:test';
import {parseFormDefinitionYaml} from '@regional-quiz/shared';
import {
  fetchSheetRows,
  sheetRowsToYaml,
  SheetFetchError,
} from './sheet-to-form-definition';

describe('fetchSheetRows', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps sheet values into SheetRow objects', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            values: [
              [
                'agree_to_rules',
                '規約に同意する',
                'チェックボックス',
                '必須',
                '',
              ],
              [
                'favorite_color',
                '好きな色',
                'ラジオボタン',
                '任意',
                'red, blue',
              ],
            ],
          }),
          {status: 200},
        ),
      )) as unknown as typeof fetch;

    const rows = await fetchSheetRows('sheet-id', 'test-api-key');

    expect(rows).toEqual([
      {
        key: 'agree_to_rules',
        label: '規約に同意する',
        type: 'チェックボックス',
        required: '必須',
        options: '',
      },
      {
        key: 'favorite_color',
        label: '好きな色',
        type: 'ラジオボタン',
        required: '任意',
        options: 'red, blue',
      },
    ]);
  });

  it('throws a SheetFetchError carrying the status on non-ok response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 403}),
      )) as unknown as typeof fetch;

    await expect(fetchSheetRows('sheet-id', 'test-api-key')).rejects.toThrow(
      'Failed to fetch sheet: 403',
    );
    try {
      await fetchSheetRows('sheet-id', 'test-api-key');
      throw new Error('expected fetchSheetRows to throw');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(SheetFetchError);
      expect((e as SheetFetchError).status).toBe(403);
    }
  });

  it('throws a SheetFetchError with no status on a network failure', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

    try {
      await fetchSheetRows('sheet-id', 'test-api-key');
      throw new Error('expected fetchSheetRows to throw');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(SheetFetchError);
      expect((e as SheetFetchError).status).toBeUndefined();
    }
  });
});

describe('sheetRowsToYaml', () => {
  it('converts rows into valid yaml, using the staff-entered key column', () => {
    const yaml = sheetRowsToYaml('test-tournament', [
      {
        key: 'agree_to_rules',
        label: '規約に同意する',
        type: 'チェックボックス',
        required: '必須',
        options: '',
      },
      {
        key: 'favorite_color',
        label: '好きな色',
        type: 'ラジオボタン',
        required: '任意',
        options: 'red, blue, green',
      },
    ]);

    const parsed = parseFormDefinitionYaml(yaml);

    expect(parsed).toEqual({
      tournamentSlug: 'test-tournament',
      fields: [
        {
          key: 'agree_to_rules',
          label: '規約に同意する',
          type: 'checkbox',
          required: true,
        },
        {
          key: 'favorite_color',
          label: '好きな色',
          type: 'radio',
          required: false,
          options: ['red', 'blue', 'green'],
        },
      ],
    });
  });

  it('coerces a non-required value to false', () => {
    const yaml = sheetRowsToYaml('test-tournament', [
      {
        key: 'agree_to_rules',
        label: '規約に同意する',
        type: 'チェックボックス',
        required: '任意',
        options: '',
      },
    ]);

    const parsed = parseFormDefinitionYaml(yaml);

    expect(parsed.fields[0].required).toBe(false);
  });

  it('throws on an unknown type label', () => {
    expect(() =>
      sheetRowsToYaml('test-tournament', [
        {
          key: 'unknown_field',
          label: '不明な種別',
          type: 'text',
          required: '必須',
          options: '',
        },
      ]),
    ).toThrow('Unknown field type: text');
  });

  it('throws on an invalid key', () => {
    expect(() =>
      sheetRowsToYaml('test-tournament', [
        {
          key: 'Invalid Key',
          label: '規約に同意する',
          type: 'チェックボックス',
          required: '必須',
          options: '',
        },
      ]),
    ).toThrow();
  });

  it('drops blank options produced by stray commas', () => {
    const yaml = sheetRowsToYaml('test-tournament', [
      {
        key: 'favorite_color',
        label: '好きな色',
        type: 'ラジオボタン',
        required: '必須',
        options: 'red, , blue,',
      },
    ]);

    const parsed = parseFormDefinitionYaml(yaml);

    expect(parsed.fields[0]).toMatchObject({options: ['red', 'blue']});
  });

  it('throws on duplicate option values', () => {
    expect(() =>
      sheetRowsToYaml('test-tournament', [
        {
          key: 'favorite_color',
          label: '好きな色',
          type: 'ラジオボタン',
          required: '必須',
          options: 'red, red',
        },
      ]),
    ).toThrow('Duplicate option values');
  });
});
