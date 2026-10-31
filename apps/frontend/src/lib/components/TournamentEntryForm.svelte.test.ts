import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import type {FormFieldDef, Regulation} from '@regional-quiz/shared';
import type {EntryFormValues} from '$lib/types/entry-form';
import TournamentEntryForm from './TournamentEntryForm.svelte';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000001';

const REGULATIONS: Regulation[] = [
  {
    id: '00000000-0000-0000-0000-0000000000a1',
    tournamentId: TOURNAMENT_ID,
    label: '一般の部',
    priorityStartsAt: null,
    priorityEndsAt: null,
    displayOrder: 0,
  },
];

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
    fieldKey: 'agree',
    label: '規約に同意する',
    plainLabel: '規約に同意する',
    fieldType: 'checkbox',
  },
  {
    ...BASE_FIELD_DEF,
    fieldKey: 'affiliation',
    label: '所属',
    plainLabel: '所属',
    fieldType: 'textfield',
  },
  {
    ...BASE_FIELD_DEF,
    fieldKey: 'note',
    label: '備考',
    plainLabel: '備考',
    fieldType: 'textarea',
  },
];

const SUBMITTED_VALUES: EntryFormValues = {
  name: '山田太郎',
  furigana: 'やまだたろう',
  displayName: '太郎',
  email: 'taro@example.com',
  regulationIds: [REGULATIONS[0].id],
  freeText: 'よろしくお願いします',
  customFieldValues: {
    lunch: '洋食',
    toppings: ['ベーコン'],
    agree: ['agree'],
    affiliation: '東京大学',
    note: 'アレルギーあり',
  },
};

function renderForm(
  options: {values?: EntryFormValues; loggedIn?: boolean} = {},
) {
  return render(TournamentEntryForm, {
    props: {
      formFieldDefs: FORM_FIELD_DEFS,
      regulations: REGULATIONS,
      entryPeriod: {
        entryOpensAt: '2020-01-01T00:00:00.000Z',
        entryClosesAt: '2099-01-01T00:00:00.000Z',
      },
      now: new Date('2026-01-01T00:00:00.000Z'),
      ...options,
    },
  });
}

/** The form element the component rendered. */
function formOf(container: Element): HTMLFormElement {
  const form = container.querySelector('form');
  if (!form) {
    throw new Error('No form was rendered.');
  }
  return form;
}

/** The form's named controls in document order, which is also tab order. */
function controlNames(form: HTMLFormElement): string[] {
  const names = Array.from(form.elements, control =>
    control.getAttribute('name'),
  ).filter(name => name !== null);
  return names.filter((name, index) => names[index - 1] !== name);
}

describe('TournamentEntryForm', () => {
  it('lays the controls out in the order of the form', () => {
    const {container} = renderForm();

    expect(controlNames(formOf(container))).toEqual([
      'name',
      'furigana',
      'displayName',
      'email',
      'password',
      'passwordConfirm',
      'regulationIds',
      'custom.lunch',
      'custom.toppings',
      'custom.agree',
      'custom.affiliation',
      'custom.note',
      'freeText',
    ]);
  });

  it('leaves the address and passwords out for a logged-in participant', () => {
    const {container} = renderForm({loggedIn: true});

    expect(controlNames(formOf(container))).toEqual([
      'name',
      'furigana',
      'displayName',
      'entryMode',
      'regulationIds',
      'custom.lunch',
      'custom.toppings',
      'custom.agree',
      'custom.affiliation',
      'custom.note',
      'freeText',
    ]);
  });

  it('submits a rejected submission again as it was', () => {
    const {container} = renderForm({values: SUBMITTED_VALUES});

    expect(Array.from(new FormData(formOf(container)))).toEqual([
      ['name', '山田太郎'],
      ['furigana', 'やまだたろう'],
      ['displayName', '太郎'],
      ['email', 'taro@example.com'],
      ['password', ''],
      ['passwordConfirm', ''],
      ['regulationIds', REGULATIONS[0].id],
      ['custom.lunch', '洋食'],
      ['custom.toppings', 'ベーコン'],
      ['custom.agree', 'agree'],
      ['custom.affiliation', '東京大学'],
      ['custom.note', 'アレルギーあり'],
      ['freeText', 'よろしくお願いします'],
    ]);
  });

  it('seeds an empty form with nothing checked', () => {
    const {container} = renderForm();

    expect(Array.from(new FormData(formOf(container)))).toEqual([
      ['name', ''],
      ['furigana', ''],
      ['displayName', ''],
      ['email', ''],
      ['password', ''],
      ['passwordConfirm', ''],
      ['custom.affiliation', ''],
      ['custom.note', ''],
      ['freeText', ''],
    ]);
  });

  it('keeps what is being typed when a rejection comes back', async () => {
    const user = userEvent.setup();
    const {rerender} = renderForm();

    await user.type(screen.getByLabelText('氏名'), '入力中の氏名');
    await user.type(screen.getByLabelText('自由記述'), '入力中の自由記述');
    await user.type(screen.getByLabelText('所属'), '入力中の所属');
    await user.click(screen.getByRole('radio', {name: '和食'}));

    // What the action echoes back is older than what the visitor has typed
    // since: the controls own their values, so they don't follow it.
    await rerender({
      values: SUBMITTED_VALUES,
      fieldErrors: {
        name: ['氏名のエラー'],
        freeText: ['自由記述のエラー'],
        'custom.affiliation': ['所属のエラー'],
        customFieldValues: ['全体のエラー'],
      },
    });

    expect(screen.getByLabelText('氏名')).toHaveValue('入力中の氏名');
    expect(screen.getByLabelText('氏名')).toHaveAccessibleDescription(
      '氏名のエラー',
    );
    expect(screen.getByLabelText('自由記述')).toHaveValue('入力中の自由記述');
    expect(screen.getByLabelText('自由記述')).toHaveAccessibleDescription(
      '自由記述のエラー',
    );
    expect(screen.getByLabelText('所属')).toHaveValue('入力中の所属');
    expect(screen.getByRole('radio', {name: '和食'})).toBeChecked();
    expect(screen.getByText('所属のエラー')).toBeInTheDocument();
    expect(screen.getByText('全体のエラー')).toBeInTheDocument();
  });

  it('keeps the answers when the page data is read again', async () => {
    const user = userEvent.setup();
    const {rerender} = renderForm({values: SUBMITTED_VALUES});

    await user.type(screen.getByLabelText('備考'), '追記');

    // `invalidateAll()` after the regulations changed hands the form new
    // arrays of the same definitions.
    await rerender({formFieldDefs: structuredClone(FORM_FIELD_DEFS)});

    expect(screen.getByLabelText('備考')).toHaveValue('アレルギーあり追記');
    expect(screen.getByLabelText('氏名')).toHaveValue('山田太郎');
    expect(screen.getByRole('radio', {name: '洋食'})).toBeChecked();
  });

  it('offers a text field the page data brought in after seeding', async () => {
    const user = userEvent.setup();
    const {rerender} = renderForm({values: SUBMITTED_VALUES});

    await rerender({
      formFieldDefs: [
        ...FORM_FIELD_DEFS,
        {
          ...BASE_FIELD_DEF,
          fieldKey: 'added',
          label: '追加項目',
          plainLabel: '追加項目',
          fieldType: 'textfield',
        },
      ],
    });

    const added = screen.getByLabelText('追加項目');
    expect(added).toHaveValue('');
    await user.type(added, '回答');
    expect(added).toHaveValue('回答');
    expect(screen.getByLabelText('氏名')).toHaveValue('山田太郎');
  });
});
