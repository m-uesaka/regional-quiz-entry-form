import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import type {FormFieldDef, MypageEntryDetail} from '@regional-quiz/shared';
import type {EntryEditFormValues} from '$lib/types/entry-form';
import EntryEditForm from './EntryEditForm.svelte';

const BASE_FIELD_DEF = {required: false, options: null, displayOrder: 0};

const FORM_FIELD_DEFS: FormFieldDef[] = [
  {
    ...BASE_FIELD_DEF,
    fieldKey: 'lunch',
    label: 'お弁当',
    plainLabel: 'お弁当',
    fieldType: 'radio',
    options: ['和食', '洋食'],
  },
  {
    ...BASE_FIELD_DEF,
    fieldKey: 'toppings',
    label: 'トッピング',
    plainLabel: 'トッピング',
    fieldType: 'checkbox',
    options: ['チーズ', 'ベーコン'],
  },
  {
    ...BASE_FIELD_DEF,
    fieldKey: 'note',
    label: '備考',
    plainLabel: '備考',
    fieldType: 'textarea',
  },
];

const ENTRY: MypageEntryDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  tournamentId: '00000000-0000-0000-0000-000000000002',
  name: '山田太郎',
  furigana: 'やまだたろう',
  displayName: '太郎',
  regulationLabels: ['一般の部'],
  freeText: null,
  customFieldValues: {lunch: '洋食', toppings: ['ベーコン']},
  status: 'confirmed',
  waitlistPosition: null,
  tournament: {
    name: 'テスト大会',
    type: 'saikyoi',
    regionId: '00000000-0000-0000-0000-000000000003',
    regionSlug: 'tokyo',
    entryOpensAt: '2020-01-01T00:00:00.000Z',
    entryClosesAt: '2099-01-01T00:00:00.000Z',
  },
  formFieldDefs: FORM_FIELD_DEFS,
};

const SUBMITTED_VALUES: EntryEditFormValues = {
  name: '鈴木一郎',
  furigana: 'すずきいちろう',
  displayName: '一郎',
  freeText: '送信した自由記述',
  customFieldValues: {lunch: '和食', toppings: [], note: '送信した備考'},
};

/** The form element the component rendered. */
function formOf(container: Element): HTMLFormElement {
  const form = container.querySelector('form');
  if (!form) {
    throw new Error('No form was rendered.');
  }
  return form;
}

describe('EntryEditForm', () => {
  it('submits the stored entry as it stands, free text first', () => {
    const {container} = render(EntryEditForm, {props: {entry: ENTRY}});

    expect(Array.from(new FormData(formOf(container)))).toEqual([
      ['name', '山田太郎'],
      ['furigana', 'やまだたろう'],
      ['displayName', '太郎'],
      ['freeText', ''],
      ['custom.lunch', '洋食'],
      ['custom.toppings', 'ベーコン'],
      ['custom.note', ''],
    ]);
  });

  it('starts from a rejected submission over the stored entry', () => {
    const {container} = render(EntryEditForm, {
      props: {entry: ENTRY, values: SUBMITTED_VALUES},
    });

    expect(Array.from(new FormData(formOf(container)))).toEqual([
      ['name', '鈴木一郎'],
      ['furigana', 'すずきいちろう'],
      ['displayName', '一郎'],
      ['freeText', '送信した自由記述'],
      ['custom.lunch', '和食'],
      ['custom.note', '送信した備考'],
    ]);
  });

  it('keeps what is being typed when a rejection comes back', async () => {
    const user = userEvent.setup();
    const {rerender} = render(EntryEditForm, {props: {entry: ENTRY}});

    await user.type(screen.getByLabelText('氏名'), '追記');
    await user.type(screen.getByLabelText('備考'), '入力中の備考');
    await user.click(screen.getByRole('checkbox', {name: 'チーズ'}));

    await rerender({
      values: SUBMITTED_VALUES,
      fieldErrors: {
        displayName: ['掲載名のエラー'],
        'custom.note': ['備考のエラー'],
      },
    });

    expect(screen.getByLabelText('氏名')).toHaveValue('山田太郎追記');
    expect(screen.getByLabelText('備考')).toHaveValue('入力中の備考');
    expect(screen.getByRole('checkbox', {name: 'チーズ'})).toBeChecked();
    expect(screen.getByRole('checkbox', {name: 'ベーコン'})).toBeChecked();
    expect(
      screen.getByLabelText('エントリーリスト掲載名'),
    ).toHaveAccessibleDescription('掲載名のエラー');
    expect(screen.getByText('備考のエラー')).toBeInTheDocument();
  });
});
