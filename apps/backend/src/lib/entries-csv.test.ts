import {describe, expect, it} from 'bun:test';
import type {FormFieldDef} from '@regional-quiz/shared';
import {buildEntriesCsv, type EntriesCsvRow} from './entries-csv';

function fieldDef(overrides: Partial<FormFieldDef> = {}): FormFieldDef {
  return {
    fieldKey: 't_shirt_size',
    label: 'Tシャツサイズ',
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
    status: '確定',
    customFieldValues: {},
    ...overrides,
  };
}

describe('buildEntriesCsv', () => {
  it('includes a header row derived from field labels', () => {
    const csv = buildEntriesCsv(FIELD_DEFS, []);

    expect(csv).toBe(
      '氏名,ふりがな,掲載名,ステータス,Tシャツサイズ,アレルギー',
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
      '氏名,ふりがな,掲載名,ステータス,Tシャツサイズ',
      '山田太郎,ヤマダタロウ,太郎,確定,M',
      '鈴木花子,スズキハナコ,花子,キャンセル待ち,S',
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
      '"山田, 太郎",ヤマダタロウ,"""太郎""",確定,"1行目',
    );
    expect(csv).toContain('"1行目\r\n2行目"');
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
      '山田太郎,ヤマダタロウ,太郎,確定,土曜;日曜',
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
      '山田太郎,ヤマダタロウ,太郎,確定,はい',
      '鈴木花子,ヤマダタロウ,太郎,確定,いいえ',
      '佐藤次郎,ヤマダタロウ,太郎,確定,いいえ',
    ]);
  });

  it('leaves the cell empty for a field the entry has no answer for', () => {
    const csv = buildEntriesCsv(FIELD_DEFS, [
      entryRow({customFieldValues: {allergies: 'そば'}}),
    ]);

    expect(csv.split('\r\n')[1]).toBe('山田太郎,ヤマダタロウ,太郎,確定,,そば');
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

    expect(csv.split('\r\n')[1]).toBe('山田太郎,ヤマダタロウ,太郎,確定,L');
  });
});
