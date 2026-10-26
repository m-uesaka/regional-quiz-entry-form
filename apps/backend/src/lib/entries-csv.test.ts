import {describe, expect, it} from 'bun:test';
import {labelPlainText, type FormFieldDef} from '@regional-quiz/shared';
import {buildEntriesCsv, type EntriesCsvRow} from './entries-csv';

function fieldDef(overrides: Partial<FormFieldDef> = {}): FormFieldDef {
  const label = overrides.label ?? 'Tシャツサイズ';
  return {
    fieldKey: 't_shirt_size',
    label,
    plainLabel: labelPlainText(label),
    fieldType: 'radio',
    required: false,
    options: ['S', 'M', 'L'],
    displayOrder: 0,
    ...overrides,
  };
}

const FIELD_DEFS: FormFieldDef[] = [
  fieldDef(),
  fieldDef({
    fieldKey: 'allergies',
    label: 'アレルギー',
    fieldType: 'textarea',
    options: null,
    displayOrder: 1,
  }),
];

function entryRow(overrides: Partial<EntriesCsvRow> = {}): EntriesCsvRow {
  return {
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    email: 'taro@example.com',
    status: '確定',
    waitlistPosition: null,
    // 12:04 in Japan.
    createdAt: '2026-10-01T03:04:00.000Z',
    regulationLabels: ['一般の部'],
    freeText: null,
    customFieldValues: {},
    ...overrides,
  };
}

describe('buildEntriesCsv', () => {
  it('includes a header row derived from field labels', () => {
    const csv = buildEntriesCsv(FIELD_DEFS, []);

    expect(csv).toBe(
      '氏名,ふりがな,エントリーリスト掲載名,メールアドレス,ステータス,キャンセル待ち順位,エントリー日時,レギュレーション,自由記述,Tシャツサイズ,アレルギー',
    );
  });

  it('heads a column whose label has a link with the link text only', () => {
    const csv = buildEntriesCsv(
      [
        fieldDef({
          fieldKey: 'agree',
          label: '<a href="https://example.com/rules">規約</a>に同意する',
          fieldType: 'checkbox',
          options: null,
        }),
      ],
      [],
    );

    expect(csv).toBe(
      '氏名,ふりがな,エントリーリスト掲載名,メールアドレス,ステータス,キャンセル待ち順位,エントリー日時,レギュレーション,自由記述,規約に同意する',
    );
  });

  it('renders one CRLF-separated row per entry', () => {
    const csv = buildEntriesCsv(
      [FIELD_DEFS[0]],
      [
        entryRow({customFieldValues: {t_shirt_size: 'M'}}),
        entryRow({
          name: '鈴木花子',
          furigana: 'スズキハナコ',
          displayName: '花子',
          status: 'キャンセル待ち',
          customFieldValues: {t_shirt_size: 'S'},
        }),
      ],
    );

    expect(csv.split('\r\n')).toEqual([
      '氏名,ふりがな,エントリーリスト掲載名,メールアドレス,ステータス,キャンセル待ち順位,エントリー日時,レギュレーション,自由記述,Tシャツサイズ',
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,M',
      '鈴木花子,スズキハナコ,花子,taro@example.com,キャンセル待ち,,2026-10-01 12:04,一般の部,,S',
    ]);
    expect(csv.endsWith('\r\n')).toBe(false);
  });

  it('escapes values containing commas or quotes', () => {
    const csv = buildEntriesCsv(
      [
        fieldDef({
          fieldKey: 'note',
          label: '備考',
          fieldType: 'textarea',
          options: null,
        }),
      ],
      [
        entryRow({
          name: '山田, 太郎',
          displayName: '"太郎"',
          customFieldValues: {note: '1行目\r\n2行目'},
        }),
      ],
    );

    expect(csv.split('\r\n')[1]).toBe(
      '"山田, 太郎",ヤマダタロウ,"""太郎""",taro@example.com,確定,,2026-10-01 12:04,一般の部,,"1行目',
    );
    expect(csv).toContain('"1行目\r\n2行目"');
  });

  it('prefixes formula-leading cells with an apostrophe', () => {
    const csv = buildEntriesCsv(
      [
        fieldDef({
          fieldKey: 'note',
          label: '備考',
          fieldType: 'textarea',
          options: null,
        }),
      ],
      [
        entryRow({
          name: '=HYPERLINK("http://evil.example","x")',
          furigana: '+ヤマダ',
          displayName: '-太郎',
          customFieldValues: {note: '@SUM(A1:A2)'},
        }),
      ],
    );

    expect(csv.split('\r\n')[1]).toBe(
      '"\'=HYPERLINK(""http://evil.example"",""x"")",\'+ヤマダ,\'-太郎,' +
        'taro@example.com,確定,,2026-10-01 12:04,一般の部,,' +
        "'@SUM(A1:A2)",
    );
  });

  it('prefixes cells whose formula hides behind leading whitespace', () => {
    const csv = buildEntriesCsv(
      [],
      [entryRow({name: '\t=1+1', displayName: '\r=1+1'})],
    );

    expect(csv.split('\r\n')[1]).toBe(
      '\'\t=1+1,ヤマダタロウ,"\'\r=1+1",taro@example.com,確定,,2026-10-01 12:04,一般の部,',
    );
  });

  it('leaves cells that only look arithmetic mid-value alone', () => {
    const csv = buildEntriesCsv([], [entryRow({displayName: '太郎=1'})]);

    expect(csv.split('\r\n')[1]).toBe(
      '山田太郎,ヤマダタロウ,太郎=1,taro@example.com,確定,,2026-10-01 12:04,一般の部,',
    );
  });

  // #178: everything an entry carries is in the export, the address and
  // the free text included.
  it('exports the address, waitlist place, entry time and free text', () => {
    const csv = buildEntriesCsv(
      [],
      [
        entryRow({
          email: 'hanako@example.com',
          status: 'キャンセル待ち',
          waitlistPosition: 3,
          // Past midnight in Japan, so the date moves on too.
          createdAt: '2026-10-01T15:30:00.000Z',
          freeText: 'よろしく\nお願いします',
        }),
      ],
    );

    expect(csv).toBe(
      '氏名,ふりがな,エントリーリスト掲載名,メールアドレス,ステータス,' +
        'キャンセル待ち順位,エントリー日時,レギュレーション,自由記述\r\n' +
        '山田太郎,ヤマダタロウ,太郎,hanako@example.com,キャンセル待ち,3,' +
        '2026-10-02 00:30,一般の部,"よろしく\nお願いします"',
    );
  });

  it('neutralizes free text that starts like a formula', () => {
    const csv = buildEntriesCsv([], [entryRow({freeText: '=1+1'})]);

    expect(csv.split('\r\n')[1]).toBe(
      "山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,'=1+1",
    );
  });

  // A form may well ask its own question under a fixed column's name; two
  // columns under one heading would be read as one by anything keyed on
  // headings.
  it('tells a custom field apart from a column already under its label', () => {
    const csv = buildEntriesCsv(
      [
        fieldDef({
          fieldKey: 'comment',
          label: '自由記述',
          fieldType: 'textarea',
          options: null,
        }),
        fieldDef({fieldKey: 'size_a', label: 'サイズ'}),
        fieldDef({fieldKey: 'size_b', label: 'サイズ'}),
      ],
      [],
    );

    expect(csv.split(',').slice(-4)).toEqual([
      '自由記述',
      '自由記述(comment)',
      'サイズ',
      'サイズ(size_b)',
    ]);
  });

  it('joins multiple regulation labels into one cell', () => {
    // An entry may meet more than one of a tournament's conditions, and the
    // header row has exactly one レギュレーション column, so they share it.
    const csv = buildEntriesCsv(
      [],
      [entryRow({regulationLabels: ['一般の部', '学生の部']})],
    );

    expect(csv.split('\r\n')[1]).toBe(
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部;学生の部,',
    );
  });

  it('leaves the regulation cell empty for an entry claiming none', () => {
    const csv = buildEntriesCsv([], [entryRow({regulationLabels: []})]);

    expect(csv.split('\r\n')[1]).toBe(
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,,',
    );
  });

  it('joins multi-select checkbox values with a semicolon', () => {
    const csv = buildEntriesCsv(
      [
        fieldDef({
          fieldKey: 'days',
          label: '参加日',
          fieldType: 'checkbox',
          options: ['土曜', '日曜'],
        }),
      ],
      [entryRow({customFieldValues: {days: ['土曜', '日曜']}})],
    );

    expect(csv.split('\r\n')[1]).toBe(
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,土曜;日曜',
    );
  });

  it('exports a chosen option with a link as its text only', () => {
    const csv = buildEntriesCsv(
      [
        fieldDef({
          fieldKey: 'events',
          label: '企画',
          fieldType: 'checkbox',
          options: ['<a href="https://e.example/a">A</a>企画', 'B企画'],
        }),
        fieldDef({
          fieldKey: 'note',
          label: '備考',
          fieldType: 'textfield',
          options: null,
        }),
      ],
      [
        entryRow({
          customFieldValues: {
            events: ['<a href="https://e.example/a">A</a>企画', 'B企画'],
            note: '<a href="https://e.example">x</a>',
          },
        }),
      ],
    );

    expect(csv.split('\r\n')[1]).toBe(
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,A企画;B企画,' +
        '"<a href=""https://e.example"">x</a>"',
    );
  });

  it('renders a boolean checkbox as a yes/no label', () => {
    const booleanField = fieldDef({
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      fieldType: 'checkbox',
      options: null,
    });

    const csv = buildEntriesCsv(
      [booleanField],
      [
        entryRow({customFieldValues: {agree_to_rules: ['agree_to_rules']}}),
        entryRow({name: '鈴木花子', customFieldValues: {agree_to_rules: []}}),
        entryRow({name: '佐藤次郎', customFieldValues: {}}),
      ],
    );

    expect(csv.split('\r\n').slice(1)).toEqual([
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,はい',
      '鈴木花子,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,いいえ',
      '佐藤次郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,',
    ]);
  });

  it('leaves the cell empty for a field the entry has no answer for', () => {
    const csv = buildEntriesCsv(FIELD_DEFS, [
      entryRow({customFieldValues: {allergies: 'そば'}}),
    ]);

    expect(csv.split('\r\n')[1]).toBe(
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,,そば',
    );
  });

  it('ignores stored answers whose field is no longer defined', () => {
    const csv = buildEntriesCsv(
      [FIELD_DEFS[0]],
      [
        entryRow({
          customFieldValues: {t_shirt_size: 'L', removed_field: '残骸'},
        }),
      ],
    );

    expect(csv.split('\r\n')[1]).toBe(
      '山田太郎,ヤマダタロウ,太郎,taro@example.com,確定,,2026-10-01 12:04,一般の部,,L',
    );
  });
});
