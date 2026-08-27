import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import type {MypageEntryDetail} from '@regional-quiz/shared';
import Page from './+page.svelte';

const ENTRY: MypageEntryDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  tournamentId: '00000000-0000-0000-0000-000000000002',
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  regulationLabel: '一般の部',
  freeText: '自由記述',
  customFieldValues: {t_shirt_size: 'M', agree_to_rules: ['agree_to_rules']},
  status: 'confirmed',
  waitlistPosition: null,
  tournament: {
    name: 'テスト大会',
    type: 'saikyoi',
    regionId: '00000000-0000-0000-0000-000000000003',
    entryOpensAt: '2020-01-01T00:00:00.000Z',
    entryClosesAt: '2099-01-01T00:00:00.000Z',
  },
  formFieldDefs: [
    {
      fieldKey: 't_shirt_size',
      label: 'Tシャツサイズ',
      fieldType: 'radio',
      required: true,
      options: ['S', 'M', 'L'],
      displayOrder: 0,
    },
    {
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      fieldType: 'checkbox',
      required: true,
      options: null,
      displayOrder: 1,
    },
  ],
};

type ActionResult = Parameters<typeof Page>[1]['form'];

/** A second entry, reached by a link that only changes the route parameter. */
const OTHER_ENTRY: MypageEntryDetail = {
  ...ENTRY,
  id: '00000000-0000-0000-0000-0000000000ff',
  name: '鈴木一郎',
  furigana: 'スズキイチロウ',
  displayName: '一郎',
  freeText: null,
  customFieldValues: {t_shirt_size: 'S', agree_to_rules: []},
};

function renderPage(form: ActionResult = null) {
  return render(Page, {
    props: {params: {entryId: ENTRY.id}, data: {entry: ENTRY}, form},
  });
}

describe('mypage entry edit +page.svelte', () => {
  it('prefills the entry-owned fields', () => {
    renderPage();

    expect(screen.getByLabelText('氏名')).toHaveValue('山田太郎');
    expect(screen.getByLabelText('ふりがな')).toHaveValue('ヤマダタロウ');
    expect(screen.getByLabelText('掲載名')).toHaveValue('太郎');
    expect(screen.getByLabelText('自由記述')).toHaveValue('自由記述');
  });

  it('renders the custom form fields with their stored answers selected', () => {
    renderPage();

    expect(screen.getByRole('radio', {name: 'M'})).toBeChecked();
    expect(screen.getByRole('radio', {name: 'S'})).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', {name: /規約に同意する/}),
    ).toBeChecked();
  });

  it('shows the action error when an update fails', () => {
    renderPage({
      error: 'エントリー期間外のため編集できません',
      fieldErrors: {},
      values: {
        name: ENTRY.name,
        furigana: ENTRY.furigana,
        displayName: ENTRY.displayName,
        freeText: ENTRY.freeText ?? '',
        customFieldValues: ENTRY.customFieldValues,
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'エントリー期間外のため編集できません',
    );
  });

  it("shows a custom field's message under its own control", () => {
    // Filed under the namespaced control name, which is also what the form
    // looks the message up by — so a custom field keyed `name` can't land
    // under the real 氏名 field.
    renderPage({
      error: '入力内容を確認してください',
      fieldErrors: {'custom.agree_to_rules': ['「規約に同意する」は必須です']},
      values: {
        name: ENTRY.name,
        furigana: ENTRY.furigana,
        displayName: ENTRY.displayName,
        freeText: ENTRY.freeText ?? '',
        customFieldValues: {t_shirt_size: 'M', agree_to_rules: []},
      },
    });

    expect(
      screen.getByText('「規約に同意する」は必須です'),
    ).toBeInTheDocument();
  });

  it('keeps what was typed when the update is rejected', () => {
    renderPage({
      error: '入力内容を確認してください',
      fieldErrors: {},
      values: {
        name: '山田花子',
        furigana: 'ヤマダハナコ',
        displayName: '花子',
        freeText: '書きかけの自由記述',
        customFieldValues: {t_shirt_size: 'L', agree_to_rules: []},
      },
    });

    expect(screen.getByLabelText('氏名')).toHaveValue('山田花子');
    expect(screen.getByLabelText('自由記述')).toHaveValue('書きかけの自由記述');
    expect(screen.getByRole('radio', {name: 'L'})).toBeChecked();
    expect(
      screen.getByRole('checkbox', {name: /規約に同意する/}),
    ).not.toBeChecked();
  });

  it('shows which regulation the entry is in', () => {
    renderPage();

    expect(screen.getByText(/一般の部/)).toBeInTheDocument();
  });

  // SvelteKit re-uses this page component across a navigation that only
  // changes the route parameters, so a move to another entry has to re-seed
  // the controls — otherwise saving would write the first entry's answers to
  // the second one. See #94.
  it('re-seeds from the entry the route moves to', async () => {
    const {rerender} = renderPage();
    await userEvent.clear(screen.getByLabelText('氏名'));
    await userEvent.type(screen.getByLabelText('氏名'), '書きかけの氏名');

    await rerender({
      params: {entryId: OTHER_ENTRY.id},
      data: {entry: OTHER_ENTRY},
      form: null,
    });

    expect(screen.getByLabelText('氏名')).toHaveValue('鈴木一郎');
    expect(screen.getByLabelText('自由記述')).toHaveValue('');
    expect(screen.getByRole('radio', {name: 'S'})).toBeChecked();
    expect(
      screen.getByRole('checkbox', {name: /規約に同意する/}),
    ).not.toBeChecked();
  });
});
