import {describe, expect, it} from 'bun:test';
import type {FormFieldDef} from '../schemas/form-definition';
import {findCustomFieldValuesError} from './custom-field-values';

const FIELD_DEFS: FormFieldDef[] = [
  {
    fieldKey: 't_shirt_size',
    label: 'Tシャツサイズ',
    fieldType: 'radio',
    required: true,
    options: ['S', 'M', 'L'],
    displayOrder: 0,
  },
  {
    fieldKey: 'allergies',
    label: 'アレルギー',
    fieldType: 'checkbox',
    required: false,
    options: ['卵', '乳'],
    displayOrder: 1,
  },
  {
    fieldKey: 'agree_to_rules',
    label: '規約に同意する',
    fieldType: 'checkbox',
    required: true,
    options: null,
    displayOrder: 2,
  },
  {
    fieldKey: 'note',
    label: '備考',
    fieldType: 'textarea',
    required: false,
    options: null,
    displayOrder: 3,
  },
];

const VALID_VALUES = {
  t_shirt_size: 'M',
  allergies: ['卵'],
  agree_to_rules: ['agree_to_rules'],
  note: '好きな文章',
};

describe('findCustomFieldValuesError', () => {
  it('accepts answers matching the field definitions', () => {
    expect(findCustomFieldValuesError(FIELD_DEFS, VALID_VALUES)).toBeNull();
  });

  it('accepts an omitted optional field', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      t_shirt_size: 'M',
      agree_to_rules: ['agree_to_rules'],
    });

    expect(error).toBeNull();
  });

  it('rejects a key the tournament does not define', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      injected: 'x',
    });

    expect(error).toContain('injected');
  });

  it('rejects an option the field does not offer', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      t_shirt_size: 'XXL',
    });

    expect(error).toContain('t_shirt_size');
  });

  it('rejects a boolean checkbox checked with a foreign value', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      agree_to_rules: ['yes'],
    });

    expect(error).toContain('agree_to_rules');
  });

  it('rejects a blank required field', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      t_shirt_size: '',
    });

    expect(error).toContain('required');
  });

  it('rejects an unchecked required boolean checkbox', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      agree_to_rules: [],
    });

    expect(error).toContain('required');
  });

  it('rejects a list answer for a single-value field', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      t_shirt_size: ['S', 'M'],
    });

    expect(error).toContain('single value');
  });

  it('rejects a scalar answer for a checkbox field', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      allergies: '卵',
    });

    expect(error).toContain('list of values');
  });

  it('rejects a scalar answer for a boolean checkbox', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      agree_to_rules: 'agree_to_rules',
    });

    expect(error).toContain('list of values');
  });

  it('accepts any text for a free-text field', () => {
    const error = findCustomFieldValuesError(FIELD_DEFS, {
      ...VALID_VALUES,
      note: '任意の内容',
    });

    expect(error).toBeNull();
  });
});
