import {afterEach, describe, expect, it} from 'bun:test';
import {parseFormDefinitionYaml} from '@regional-quiz/shared';
import {fetchSheetRows, sheetRowsToYaml} from './sheet-to-form-definition';

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
              ['規約に同意する', 'チェックボックス', '必須', ''],
              ['好きな色', 'ラジオボタン', '任意', 'red, blue'],
            ],
          }),
          {status: 200},
        ),
      )) as unknown as typeof fetch;

    const rows = await fetchSheetRows('sheet-id', 'test-api-key');

    expect(rows).toEqual([
      {
        label: '規約に同意する',
        type: 'チェックボックス',
        required: '必須',
        options: '',
      },
      {
        label: '好きな色',
        type: 'ラジオボタン',
        required: '任意',
        options: 'red, blue',
      },
    ]);
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 403}),
      )) as unknown as typeof fetch;

    await expect(fetchSheetRows('sheet-id', 'test-api-key')).rejects.toThrow(
      'Failed to fetch sheet: 403',
    );
  });
});

describe('sheetRowsToYaml', () => {
  it('converts rows into valid yaml, generating keys from row position', () => {
    const yaml = sheetRowsToYaml('test-tournament', [
      {
        label: '規約に同意する',
        type: 'チェックボックス',
        required: '必須',
        options: '',
      },
      {
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
          key: 'field_1',
          label: '規約に同意する',
          type: 'checkbox',
          required: true,
        },
        {
          key: 'field_2',
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
          label: '不明な種別',
          type: 'text',
          required: '必須',
          options: '',
        },
      ]),
    ).toThrow('Unknown field type: text');
  });
});
