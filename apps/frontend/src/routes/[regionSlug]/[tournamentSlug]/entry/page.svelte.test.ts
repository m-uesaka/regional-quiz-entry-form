import {render, screen} from '@testing-library/svelte';
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
  render(Page, {
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
  regulationId: REGULATIONS[1].id,
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

    expect(screen.getByRole('radio', {name: /一般の部/})).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: /学生の部/})).toBeInTheDocument();
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
    expect(screen.getByRole('radio', {name: /学生の部/})).toBeChecked();
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

  it('replaces the form with a confirmation once the entry is accepted', () => {
    renderPage({submitted: true, email: 'taro@example.com'});

    expect(screen.getByRole('status')).toHaveTextContent('taro@example.com');
    expect(screen.queryByLabelText('氏名')).not.toBeInTheDocument();
  });
});
