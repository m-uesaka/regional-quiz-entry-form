import {describe, expect, it} from 'vitest';
import type {FormFieldDef} from '@regional-quiz/shared';
import {firstFieldError, initialCustomFieldValues} from './entry-form';

const BASE_FIELD_DEF = {
  label: '項目',
  plainLabel: '項目',
  required: false,
  options: null,
  displayOrder: 0,
};

const FORM_FIELD_DEFS: FormFieldDef[] = [
  {...BASE_FIELD_DEF, fieldKey: 'lunch', fieldType: 'radio'},
  {...BASE_FIELD_DEF, fieldKey: 'agree', fieldType: 'checkbox'},
  {...BASE_FIELD_DEF, fieldKey: 'affiliation', fieldType: 'textfield'},
  {...BASE_FIELD_DEF, fieldKey: 'note', fieldType: 'textarea'},
];

describe('firstFieldError', () => {
  it('picks the first message filed for the field', () => {
    expect(firstFieldError({name: ['一つ目', '二つ目']}, 'name')).toBe(
      '一つ目',
    );
  });

  it('has nothing to say about a field with no messages', () => {
    expect(firstFieldError({name: []}, 'name')).toBeUndefined();
    expect(firstFieldError({name: undefined}, 'name')).toBeUndefined();
    expect(firstFieldError({}, 'name')).toBeUndefined();
  });

  it('has nothing to say before anything has been rejected', () => {
    expect(firstFieldError(undefined, 'name')).toBeUndefined();
  });
});

describe('initialCustomFieldValues', () => {
  it('seeds every field by its type when nothing was answered', () => {
    const empty = {lunch: '', agree: [], affiliation: '', note: ''};

    expect(initialCustomFieldValues(FORM_FIELD_DEFS)).toEqual(empty);
    expect(initialCustomFieldValues(FORM_FIELD_DEFS, {})).toEqual(empty);
  });

  it('starts from the answers there are, seeding the rest', () => {
    expect(
      initialCustomFieldValues(FORM_FIELD_DEFS, {
        lunch: '和食',
        agree: ['agree'],
      }),
    ).toEqual({lunch: '和食', agree: ['agree'], affiliation: '', note: ''});
  });

  it('keeps an empty answer rather than seeding over it', () => {
    expect(
      initialCustomFieldValues(FORM_FIELD_DEFS, {agree: [], note: ''}),
    ).toEqual({lunch: '', agree: [], affiliation: '', note: ''});
  });

  it('leaves out an answer to a field the form no longer has', () => {
    expect(
      initialCustomFieldValues(FORM_FIELD_DEFS.slice(0, 1), {
        lunch: '和食',
        removed: '古い回答',
      }),
    ).toEqual({lunch: '和食'});
  });

  it('does not touch what it was given', () => {
    const answered = {agree: ['agree']};

    const seeded = initialCustomFieldValues(FORM_FIELD_DEFS, answered);
    seeded.lunch = '洋食';

    expect(answered).toEqual({agree: ['agree']});
  });
});
