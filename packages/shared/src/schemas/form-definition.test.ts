import {describe, expect, it} from 'bun:test';
import {ZodError} from 'zod';
import {
  FormFieldDefSchema,
  parseFormDefinitionYaml,
  toFormFieldDefRows,
  toFormFieldDefYaml,
} from './form-definition';

describe('parseFormDefinitionYaml', () => {
  it('parses a valid document', () => {
    const yamlText = `
tournamentSlug: kanto-saikyoi
fields:
  - key: agree_to_rules
    label: 規約に同意する
    type: checkbox
  - key: seat_preference
    label: 座席の希望
    type: radio
    options:
      - front
      - back
  - key: comment
    label: コメント
    type: textarea
`;

    const result = parseFormDefinitionYaml(yamlText);

    expect(result.fields.length).toBe(3);
  });

  it('rejects an invalid field key', () => {
    const yamlText = `
tournamentSlug: kanto-saikyoi
fields:
  - key: Invalid_Key
    label: 不正なキー
    type: checkbox
`;

    expect(() => parseFormDefinitionYaml(yamlText)).toThrow(ZodError);
  });

  it('rejects a radio field with no options', () => {
    const yamlText = `
tournamentSlug: kanto-saikyoi
fields:
  - key: seat_preference
    label: 座席の希望
    type: radio
`;

    expect(() => parseFormDefinitionYaml(yamlText)).toThrow(ZodError);
  });

  it('rejects duplicate field keys', () => {
    const yamlText = `
tournamentSlug: kanto-saikyoi
fields:
  - key: comment
    label: コメント1
    type: textarea
  - key: comment
    label: コメント2
    type: textarea
`;

    expect(() => parseFormDefinitionYaml(yamlText)).toThrow(ZodError);
  });
});

describe('toFormFieldDefRows', () => {
  it('converts parsed fields into form_field_defs rows', () => {
    const definition = parseFormDefinitionYaml(`
tournamentSlug: kanto-saikyoi
fields:
  - key: agree_to_rules
    label: 規約に同意する
    type: checkbox
    required: true
`);

    const rows = toFormFieldDefRows(
      definition,
      '00000000-0000-0000-0000-000000000000',
    );

    expect(rows).toEqual([
      {
        tournamentId: '00000000-0000-0000-0000-000000000000',
        fieldKey: 'agree_to_rules',
        label: '規約に同意する',
        fieldType: 'checkbox',
        required: true,
        options: null,
        displayOrder: 0,
      },
    ]);
  });
});

describe('FormFieldDefSchema', () => {
  it('accepts a field def with null options', () => {
    const result = FormFieldDefSchema.safeParse({
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      fieldType: 'checkbox',
      required: true,
      options: null,
      displayOrder: 0,
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown fieldType', () => {
    const result = FormFieldDefSchema.safeParse({
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      fieldType: 'not-a-real-type',
      required: true,
      options: null,
      displayOrder: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe('toFormFieldDefYaml', () => {
  it('converts a stored radio field def back into the rendering shape', () => {
    const yaml = toFormFieldDefYaml({
      fieldKey: 't_shirt_size',
      label: 'Tシャツサイズ',
      fieldType: 'radio',
      required: true,
      options: ['S', 'M', 'L'],
      displayOrder: 0,
    });

    expect(yaml).toEqual({
      key: 't_shirt_size',
      label: 'Tシャツサイズ',
      type: 'radio',
      required: true,
      options: ['S', 'M', 'L'],
    });
  });

  it('converts null options to undefined for a boolean checkbox', () => {
    const yaml = toFormFieldDefYaml({
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      fieldType: 'checkbox',
      required: false,
      options: null,
      displayOrder: 1,
    });

    expect(yaml).toEqual({
      key: 'agree_to_rules',
      label: '規約に同意する',
      type: 'checkbox',
      required: false,
      options: undefined,
    });
  });
});
