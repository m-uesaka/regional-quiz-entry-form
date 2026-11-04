import {afterEach, describe, expect, it} from 'bun:test';
import {parseFormDefinitionYaml} from '@regional-quiz/shared';
import {SheetFetchError} from './google-sheets';
import {
  fetchSheetRows,
  formRowsToFields,
  FormSheetError,
  sheetRowsToYaml,
  sheetValuesToRows,
  type SheetRow,
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
    const yaml = sheetRowsToYaml('saikyoi', [
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
      tournamentSlug: 'saikyoi',
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
    const yaml = sheetRowsToYaml('saikyoi', [
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

  it('reads the one-line free text label as a textfield', () => {
    const yaml = sheetRowsToYaml('saikyoi', [
      {
        key: 'affiliation',
        label: '所属',
        type: '自由記述（一行）',
        required: '必須',
        options: '',
      },
    ]);

    expect(parseFormDefinitionYaml(yaml).fields[0]).toEqual({
      key: 'affiliation',
      label: '所属',
      type: 'textfield',
      required: true,
    });
  });

  it('throws on an unknown type label', () => {
    expect(() =>
      sheetRowsToYaml('saikyoi', [
        {
          key: 'unknown_field',
          label: '不明な種別',
          type: 'text',
          required: '必須',
          options: '',
        },
      ]),
    ).toThrow(
      'フォーム定義 2行目: C列(type)「text」はチェックボックス・ラジオボタン・自由記述・自由記述（一行）のいずれでもありません',
    );
  });

  it('throws on an invalid key', () => {
    expect(() =>
      sheetRowsToYaml('saikyoi', [
        {
          key: 'Invalid Key',
          label: '規約に同意する',
          type: 'チェックボックス',
          required: '必須',
          options: '',
        },
      ]),
    ).toThrow('フォーム定義 2行目: A列(key)「Invalid Key」');
  });

  it('drops blank options produced by stray commas', () => {
    const yaml = sheetRowsToYaml('saikyoi', [
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
      sheetRowsToYaml('saikyoi', [
        {
          key: 'favorite_color',
          label: '好きな色',
          type: 'ラジオボタン',
          required: '必須',
          options: 'red, red',
        },
      ]),
    ).toThrow('フォーム定義 2行目: E列(options)に同じ選択肢が複数あります');
  });
});

describe('formRowsToFields', () => {
  const NOTES: SheetRow = {
    key: 'notes',
    label: '備考',
    type: '自由記述',
    required: '任意',
    options: undefined,
  };

  it('reads each row into a field', () => {
    expect(formRowsToFields([NOTES])).toEqual([
      {key: 'notes', label: '備考', type: 'textarea', required: false},
    ]);
  });

  it('names the row a mistake is on, in Japanese', () => {
    const cases: Array<[unknown[][], string]> = [
      [
        [
          ['notes', '備考', '自由記述', '任意'],
          ['Bad Key', '備考', '自由記述', '任意'],
        ],
        'フォーム定義 3行目: A列(key)「Bad Key」は小文字の英字で始まり、小文字の英数字と _ だけにしてください',
      ],
      [
        [['notes', '備考', '自由記述'], [], ['memo', 'メモ', '自由記述']],
        'フォーム定義 3行目: C列(type)が空です。途中に空行がある場合は行を詰めてください',
      ],
      [
        [['size', 'サイズ', 'ラジオボタン', '必須', 'S, S']],
        'フォーム定義 2行目: E列(options)に同じ選択肢が複数あります',
      ],
      [
        [['size', 'サイズ', 'ラジオボタン', '必須']],
        'フォーム定義 2行目: ラジオボタンには E列(options)に選択肢が1つ以上必要です',
      ],
      // A grid cell without a displayed value, inside the row.
      [
        [['notes', undefined, '自由記述']],
        'フォーム定義 2行目: B列(label)の値が正しくありません',
      ],
      [
        [
          ['notes', '備考', '自由記述'],
          ['notes', '備考2', '自由記述'],
        ],
        'フォーム定義 2行目と3行目: A列(key)「notes」が複数の行で使われています',
      ],
      [[['', '備考', '自由記述']], 'フォーム定義 2行目: A列(key)が空です'],
      [
        [[undefined, '備考', '自由記述']],
        'フォーム定義 2行目: A列(key)が空です',
      ],
      // A name `Object.prototype` holds is still an unknown label.
      [
        [['notes', '備考', 'constructor']],
        'フォーム定義 2行目: C列(type)「constructor」はチェックボックス・ラジオボタン・自由記述・自由記述（一行）のいずれでもありません',
      ],
      [
        [['notes', '備考', '  ']],
        'フォーム定義 2行目: C列(type)が空です。途中に空行がある場合は行を詰めてください',
      ],
    ];
    for (const [values, message] of cases) {
      const rows = sheetValuesToRows(values);
      expect(() => formRowsToFields(rows)).toThrow(FormSheetError);
      expect(() => formRowsToFields(rows)).toThrow(message);
    }
  });

  it('matches the type and required cells despite stray spaces', () => {
    const [field] = formRowsToFields(
      sheetValuesToRows([['notes', '備考', ' 自由記述 ', ' 必須']]),
    );

    expect(field).toMatchObject({type: 'textarea', required: true});
  });

  it('keeps an empty label, which the schema takes', () => {
    const [field] = formRowsToFields(
      sheetValuesToRows([['notes', '', '自由記述']]),
    );

    expect(field.label).toBe('');
  });
});
