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
              ['agree_rules', '規約に同意する', 'checkbox', 'TRUE', ''],
              ['favorite_color', '好きな色', 'radio', 'FALSE', 'red, blue'],
            ],
          }),
          {status: 200},
        ),
      )) as unknown as typeof fetch;

    const rows = await fetchSheetRows('sheet-id', 'test-api-key');

    expect(rows).toEqual([
      {
        key: 'agree_rules',
        label: '規約に同意する',
        type: 'checkbox',
        required: 'TRUE',
        options: '',
      },
      {
        key: 'favorite_color',
        label: '好きな色',
        type: 'radio',
        required: 'FALSE',
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
  it('converts rows into valid yaml', () => {
    const yaml = sheetRowsToYaml('test-tournament', [
      {
        key: 'favorite_color',
        label: '好きな色',
        type: 'checkbox',
        required: 'TRUE',
        options: 'red, blue, green',
      },
    ]);

    const parsed = parseFormDefinitionYaml(yaml);

    expect(parsed).toEqual({
      tournamentSlug: 'test-tournament',
      fields: [
        {
          key: 'favorite_color',
          label: '好きな色',
          type: 'checkbox',
          required: true,
          options: ['red', 'blue', 'green'],
        },
      ],
    });
  });

  it('coerces a non-TRUE required value to false', () => {
    const yaml = sheetRowsToYaml('test-tournament', [
      {
        key: 'agree_rules',
        label: '規約に同意する',
        type: 'checkbox',
        required: 'FALSE',
        options: '',
      },
    ]);

    const parsed = parseFormDefinitionYaml(yaml);

    expect(parsed.fields[0].required).toBe(false);
  });

  it('throws on invalid field key', () => {
    expect(() =>
      sheetRowsToYaml('test-tournament', [
        {
          key: 'Invalid-Key',
          label: '不正なキー',
          type: 'checkbox',
          required: 'TRUE',
          options: '',
        },
      ]),
    ).toThrow();
  });
});
