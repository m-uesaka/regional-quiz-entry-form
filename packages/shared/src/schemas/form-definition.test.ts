import {describe, expect, it} from 'bun:test';
import {ZodError} from 'zod';
import {parseFormDefinitionYaml, toFormFieldDefRows} from './form-definition';

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
