import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import type {FormFieldDef, Regulation, Tournament} from '@regional-quiz/shared';
import Page from './+page.svelte';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
};

/** A second tournament, reached by a link that only changes the slug. */
const OTHER_TOURNAMENT_ID = '00000000-0000-0000-0000-0000000000ff';

const REGULATIONS: Regulation[] = [
  {
    id: '00000000-0000-0000-0000-0000000000a1',
    tournamentId: TOURNAMENT.id,
    label: '一般の部',
    priorityStartsAt: null,
    priorityEndsAt: null,
    displayOrder: 0,
  },
  {
    id: '00000000-0000-0000-0000-0000000000a2',
    tournamentId: TOURNAMENT.id,
    label: '学生の部',
    priorityStartsAt: null,
    priorityEndsAt: null,
    displayOrder: 1,
  },
];

const FORM_FIELD_DEFS: FormFieldDef[] = [
  {
    fieldKey: 't_shirt_size',
    label: 'Tシャツサイズ',
    fieldType: 'radio',
    required: true,
    options: ['S', 'M', 'L'],
    displayOrder: 0,
  },
  {
    fieldKey: 'agree_rules',
    label: '規約に同意する',
    fieldType: 'checkbox',
    required: true,
    options: null,
    displayOrder: 1,
  },
];

type ActionResult = Parameters<typeof Page>[1]['form'];

function renderPage(form: ActionResult = null) {
  return render(Page, {
    props: {
      params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
      data: {
        tournament: TOURNAMENT,
        regulations: REGULATIONS,
        formFieldDefs: FORM_FIELD_DEFS,
      },
      form,
    },
  });
}

const SUBMITTED_VALUES = {
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'taro@example.com',
  regulationIds: [REGULATIONS[1].id],
  freeText: 'よろしくお願いします',
  customFieldValues: {t_shirt_size: 'M', agree_rules: ['agree_rules']},
};

describe('entry +page.svelte', () => {
  it('renders the entry form fields', () => {
    renderPage();

    expect(screen.getByLabelText('氏名')).toBeInTheDocument();
    expect(screen.getByLabelText('ふりがな')).toBeInTheDocument();
    expect(screen.getByLabelText('掲載名')).toBeInTheDocument();
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード(確認)')).toBeInTheDocument();
    expect(screen.getByLabelText('自由記述')).toBeInTheDocument();
  });

  it('renders the regulation choices and the custom form fields', () => {
    renderPage();

    expect(
      screen.getByRole('checkbox', {name: /一般の部/}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {name: /学生の部/}),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: 'M'})).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {name: /規約に同意する/}),
    ).toBeInTheDocument();
  });

  it('re-renders what was typed after a rejected submission', () => {
    renderPage({
      error: 'この大会には既にエントリー済みです',
      fieldErrors: {},
      values: SUBMITTED_VALUES,
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'この大会には既にエントリー済みです',
    );
    expect(screen.getByLabelText('氏名')).toHaveValue('山田太郎');
    expect(screen.getByLabelText('メールアドレス')).toHaveValue(
      'taro@example.com',
    );
    expect(screen.getByLabelText('自由記述')).toHaveValue(
      'よろしくお願いします',
    );
    expect(screen.getByRole('checkbox', {name: /学生の部/})).toBeChecked();
    expect(screen.getByRole('radio', {name: 'M'})).toBeChecked();
    expect(
      screen.getByRole('checkbox', {name: /規約に同意する/}),
    ).toBeChecked();
  });

  it('leaves the password fields blank after a rejected submission', () => {
    renderPage({
      error: 'パスワードが正しくありません',
      fieldErrors: {},
      values: SUBMITTED_VALUES,
    });

    expect(screen.getByLabelText('パスワード')).toHaveValue('');
    expect(screen.getByLabelText('パスワード(確認)')).toHaveValue('');
  });

  it('shows a per-field message for a mismatched password confirmation', () => {
    renderPage({
      error: '入力内容を確認してください',
      fieldErrors: {passwordConfirm: ['パスワードが一致しません']},
      values: SUBMITTED_VALUES,
    });

    expect(screen.getByText('パスワードが一致しません')).toBeInTheDocument();
  });

  it("shows a custom field's message under its own control", () => {
    // Filed under the namespaced control name, which is also what the
    // page looks the message up by — so a custom field keyed `name` can't
    // land under the real 氏名 field.
    renderPage({
      error: '入力内容を確認してください',
      fieldErrors: {'custom.agree_rules': ['「規約に同意する」は必須です']},
      values: SUBMITTED_VALUES,
    });

    expect(
      screen.getByText('「規約に同意する」は必須です'),
    ).toBeInTheDocument();
  });

  it('replaces the form with a confirmation once the entry is accepted', () => {
    renderPage({submitted: true, email: 'taro@example.com'});

    expect(screen.getByRole('status')).toHaveTextContent('taro@example.com');
    expect(screen.queryByLabelText('氏名')).not.toBeInTheDocument();
  });

  // SvelteKit re-uses this page component across a navigation that only
  // changes the route parameters, so a move to another tournament's form has
  // to build the controls afresh rather than leave the previous tournament's
  // answers standing in them. See #94.
  it('starts over when the route moves to another tournament', async () => {
    const {rerender} = renderPage();
    await userEvent.type(screen.getByLabelText('氏名'), '山田太郎');
    await userEvent.click(screen.getByRole('radio', {name: 'M'}));

    await rerender({
      params: {regionSlug: 'tokyo', tournamentSlug: 'shinjinou'},
      data: {
        tournament: {...TOURNAMENT, id: OTHER_TOURNAMENT_ID, type: 'shinjinou'},
        regulations: REGULATIONS,
        formFieldDefs: FORM_FIELD_DEFS,
      },
      form: null,
    });

    expect(screen.getByLabelText('氏名')).toHaveValue('');
    expect(screen.getByRole('radio', {name: 'M'})).not.toBeChecked();
  });
});
