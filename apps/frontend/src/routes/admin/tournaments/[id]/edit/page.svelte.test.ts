import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  TOURNAMENT_REGION_TYPE_LOCKED_MESSAGE,
  type Region,
  type StaffClaims,
  type Tournament,
} from '@regional-quiz/shared';
import type {SubmitFunction} from '@sveltejs/kit';
import {RESET_CONFIRMATION_WORD} from '$lib/tournament-form';
import Page from './+page.svelte';
import type {PageProps} from './$types';

// The forms `use:enhance` was put on, with the callback each was given.
// Outside a running app the real action would reach for a router that
// isn't there, so what is checked is that each form is enhanced and how
// it asks for the update.
const enhancedForms = vi.hoisted(
  () => new Map<HTMLFormElement, SubmitFunction | undefined>(),
);
vi.mock('$app/forms', () => ({
  enhance: (form: HTMLFormElement, submit?: SubmitFunction) => {
    enhancedForms.set(form, submit);
  },
}));

afterEach(() => {
  enhancedForms.clear();
});

type SubmitInput = Parameters<SubmitFunction>[0];
type SubmitCallback = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;
type SubmitResult = Parameters<SubmitCallback>[0]['result'];

/**
 * Starts the enhanced submission of the form holding the named button, as
 * `use:enhance` would on a submit.
 * @param buttonName The form's submit button.
 * @return The form, whether the submission was cancelled, and the callback
 *     to hand the action's answer to.
 */
async function startSubmit(buttonName: string) {
  const form = screen
    .getByRole('button', {name: buttonName})
    .closest('form') as HTMLFormElement;
  const cancel = vi.fn();
  const callback = await enhancedForms.get(form)?.({
    cancel,
    formElement: form,
  } as unknown as SubmitInput);
  return {form, cancel, callback: callback as SubmitCallback | undefined};
}

/**
 * Hands the action's answer to a started submission.
 * @param callback What `startSubmit` returned.
 * @param result The answer.
 * @return The `update` stand-in it was given.
 */
async function answer(
  callback: SubmitCallback | undefined,
  result: SubmitResult,
) {
  const update = vi.fn();
  await callback?.({
    result,
    update,
  } as unknown as Parameters<SubmitCallback>[0]);
  return update;
}

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000011',
  type: 'saikyoi',
  name: '第1回テスト最強位',
  capacity: 64,
  entryOpensAt: '2026-01-01T00:00:00.000Z',
  entryClosesAt: '2026-02-01T00:00:00.000Z',
  entriesPaused: false,
  questionSet: null,
};

// The 問題セット names other tournaments use, suggested by the form.
const QUESTION_SETS = ['宮崎', '鹿児島'];

const REGIONS: Region[] = [
  {
    id: '00000000-0000-0000-0000-000000000011',
    slug: 'tokyo',
    name: '東京',
    allowsDualEntry: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000022',
    slug: 'osaka',
    name: '大阪',
    allowsDualEntry: true,
  },
];

// Handed down by `routes/admin/+layout.server.ts`.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
};

const FORM_DEFINITION_YAML =
  'tournamentSlug: saikyoi\nfields:\n  - key: note\n    label: 備考\n    type: textarea\n    required: false\n';

/** A second tournament, reached by a link that only changes `[id]`. */
const OTHER_TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-0000000000ff',
  regionId: '00000000-0000-0000-0000-000000000022',
  type: 'shinjinou',
  name: '第2回テスト新人王',
  capacity: null,
  entryOpensAt: '2026-03-01T00:00:00.000Z',
  entryClosesAt: '2026-04-01T00:00:00.000Z',
  entriesPaused: false,
  questionSet: null,
};

function renderPage(
  tournament: Tournament = TOURNAMENT,
  form: PageProps['form'] = null,
  customName: string | null = tournament.name,
  hasEntries = false,
) {
  return render(Page, {
    props: {
      params: {id: tournament.id},
      data: {
        staff: STAFF,
        tournament,
        customName,
        regions: REGIONS,
        questionSets: QUESTION_SETS,
        hasEntries,
        formDefinitionYaml: FORM_DEFINITION_YAML,
      },
      form,
    },
  });
}

describe('admin tournament edit +page.svelte', () => {
  it('prefills the form with the tournament being edited', () => {
    renderPage();

    expect(screen.getByLabelText('地域')).toHaveValue(TOURNAMENT.regionId);
    expect(screen.getByLabelText(/大会名/)).toHaveValue(TOURNAMENT.name);
    expect(screen.getByLabelText(/定員/)).toHaveValue(TOURNAMENT.capacity);
    expect(screen.getByLabelText('種別')).toHaveValue('saikyoi');
    expect(screen.getByText(/対象: 最強位/)).toBeInTheDocument();
  });

  // A 大会名 left blank is answered as the default name (東京最強位), which
  // must not come back as a typed one: a region fixed on this form would
  // then keep the old region's name.
  it('shows the stored 問題セット, suggesting the names already in use', () => {
    renderPage({...TOURNAMENT, questionSet: '宮崎'});

    const input = screen.getByLabelText(/問題セット/);
    expect(input).toHaveValue('宮崎');
    const options = document.querySelectorAll(
      `#${input.getAttribute('list')} option`,
    );
    expect([...options].map(option => option.getAttribute('value'))).toEqual(
      QUESTION_SETS,
    );
  });

  it('leaves the 問題セット of a tournament on the common questions blank', () => {
    renderPage(TOURNAMENT);

    expect(screen.getByLabelText(/問題セット/)).toHaveValue('');
  });

  it('leaves a blank 大会名 blank rather than showing the default name', () => {
    renderPage({...TOURNAMENT, name: '東京最強位'}, null, null);

    expect(screen.getByLabelText(/大会名/)).toHaveValue('');
  });

  // The entry window is labelled JST, and is server-rendered by a Worker
  // whose own clock is UTC — so neither end may be read in whatever zone the
  // runtime happens to be set to.
  it('shows the entry window as its JST wall-clock time', () => {
    renderPage();

    // 2026-01-01T00:00Z and 2026-02-01T00:00Z, in JST.
    expect(screen.getByLabelText(/エントリー開始日時/)).toHaveValue(
      '2026-01-01T09:00',
    );
    expect(screen.getByLabelText(/エントリー終了日時/)).toHaveValue(
      '2026-02-01T09:00',
    );
  });

  // `/api/*` is only routed to the backend Worker for requests the frontend
  // makes itself, so a save sent from the browser 404s in production. The
  // form posts to the page's own `update` action instead.
  it('saves through the page action rather than from the browser', () => {
    renderPage();

    const form = screen
      .getByRole('button', {name: '更新'})
      .closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', '?/update');
    expect(form.elements.namedItem('name')).toHaveValue(TOURNAMENT.name);
    expect(form.elements.namedItem('entryOpensAt')).toHaveValue(
      '2026-01-01T09:00',
    );
  });

  it('reports a saved update', () => {
    renderPage(TOURNAMENT, {
      saved: true,
      error: null,
      values: null,
      promotion: {promotedCount: 0, mailFailedCount: 0},
    });

    expect(screen.getByRole('status')).toHaveTextContent('更新しました');
  });

  // A saved capacity promoted the waitlist (#223).
  it('says how many waitlisted entries a saved capacity promoted', () => {
    renderPage(TOURNAMENT, {
      saved: true,
      error: null,
      values: null,
      promotion: {promotedCount: 2, mailFailedCount: 0},
    });

    expect(
      screen.getByText('キャンセル待ち2件を繰り上げ、通知メールを送りました'),
    ).toBeInTheDocument();
  });

  it('says when the promotion failed', () => {
    renderPage(TOURNAMENT, {
      saved: true,
      error: null,
      values: null,
      promotion: null,
    });

    expect(
      screen.getByText(/キャンセル待ちの繰り上げに失敗しました/),
    ).toBeInTheDocument();
  });

  it('re-renders what a refused save carried, with its message', () => {
    renderPage(TOURNAMENT, {
      saved: false,
      promotion: null,
      error: 'regionId が不正です',
      values: {
        regionId: REGIONS[1].id,
        type: 'shinjinou',
        name: '書きかけの大会名',
        capacity: '',
        entryOpensAt: '2026-01-01T09:00',
        entryClosesAt: '2026-02-01T09:00',
        questionSet: '宮 崎',
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('regionId が不正です');
    expect(screen.getByLabelText(/大会名/)).toHaveValue('書きかけの大会名');
    expect(screen.getByLabelText(/問題セット/)).toHaveValue('宮 崎');
    expect(screen.getByLabelText('地域')).toHaveValue(REGIONS[1].id);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // #284: the database refuses to move a tournament with entries, so the
  // controls say so up front instead of the save failing as a whole.
  it('locks the region and type of a tournament with entries', () => {
    renderPage(TOURNAMENT, null, TOURNAMENT.name, true);

    const region = screen.getByLabelText('地域');
    const type = screen.getByLabelText('種別');
    expect(region).toBeDisabled();
    expect(type).toBeDisabled();
    expect(region).toHaveAccessibleDescription(
      'エントリーがあるため、地域と種別は変更できません。',
    );
    expect(type).toHaveAccessibleDescription(
      'エントリーがあるため、地域と種別は変更できません。',
    );
    expect(screen.getByLabelText(/大会名/)).toBeEnabled();
    // Disabled controls aren't submitted; the stored values go in their
    // place, once each, so the save neither fails validation nor moves it.
    const form = screen
      .getByRole('button', {name: '更新'})
      .closest('form') as HTMLFormElement;
    const submitted = new FormData(form);
    expect(submitted.getAll('regionId')).toEqual([TOURNAMENT.regionId]);
    expect(submitted.getAll('type')).toEqual([TOURNAMENT.type]);
  });

  it('leaves the region and type of a tournament without entries open', () => {
    renderPage();

    expect(screen.getByLabelText('地域')).toBeEnabled();
    expect(screen.getByLabelText('種別')).toBeEnabled();
    expect(
      screen.queryByText('エントリーがあるため、地域と種別は変更できません。'),
    ).not.toBeInTheDocument();
  });

  // The page was rendered before the first entry arrived, so the move went
  // out and was refused (409); `load` now knows of the entries.
  it('shows the stored region and type after a move refused for its entries', () => {
    renderPage(
      TOURNAMENT,
      {
        saved: false,
        promotion: null,
        error: TOURNAMENT_REGION_TYPE_LOCKED_MESSAGE,
        values: {
          regionId: REGIONS[1].id,
          type: 'shinjinou',
          name: '書きかけの大会名',
          capacity: '',
          entryOpensAt: '2026-01-01T09:00',
          entryClosesAt: '2026-02-01T09:00',
          questionSet: '',
        },
      },
      TOURNAMENT.name,
      true,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      TOURNAMENT_REGION_TYPE_LOCKED_MESSAGE,
    );
    expect(screen.getByLabelText('地域')).toHaveValue(TOURNAMENT.regionId);
    expect(screen.getByLabelText('種別')).toHaveValue(TOURNAMENT.type);
    expect(screen.getByLabelText(/大会名/)).toHaveValue('書きかけの大会名');
  });

  // The previewed YAML carries the tournament's type as its
  // `tournamentSlug`, and the API refuses an upload whose slug doesn't match
  // the target tournament — so the panel follows the type `load` last read
  // rather than the one the page was first rendered with.
  it('follows a saved type change in the import panel', async () => {
    const {rerender} = renderPage();
    expect(screen.getByText(/対象: 最強位/)).toBeInTheDocument();

    await rerender({
      params: {id: TOURNAMENT.id},
      data: {
        staff: STAFF,
        tournament: {...TOURNAMENT, type: 'shinjinou'},
        customName: TOURNAMENT.name,
        regions: REGIONS,
        questionSets: QUESTION_SETS,
        hasEntries: false,
        formDefinitionYaml: 'tournamentSlug: shinjinou\nfields: []\n',
      },
      form: {
        saved: true,
        error: null,
        values: null,
        promotion: {promotedCount: 0, mailFailedCount: 0},
      },
    });

    expect(screen.getByText(/対象: 新人王/)).toBeInTheDocument();
    expect(screen.getByLabelText('YAML')).toHaveValue(
      'tournamentSlug: shinjinou\nfields: []\n',
    );
  });

  // SvelteKit re-uses this page component across a navigation that only
  // changes the route parameters, so a move to another tournament has to
  // re-seed everything the first one left behind — otherwise the import
  // panel would file the first one's sheet under the second one's id.
  // See #98.
  it('re-seeds from the tournament the route moves to', async () => {
    const {rerender} = renderPage();

    await rerender({
      params: {id: OTHER_TOURNAMENT.id},
      data: {
        staff: STAFF,
        tournament: OTHER_TOURNAMENT,
        customName: OTHER_TOURNAMENT.name,
        regions: REGIONS,
        questionSets: QUESTION_SETS,
        hasEntries: false,
        formDefinitionYaml: 'tournamentSlug: shinjinou\nfields: []\n',
      },
      form: null,
    });

    expect(screen.getByLabelText(/大会名/)).toHaveValue(OTHER_TOURNAMENT.name);
    expect(screen.getByLabelText('地域')).toHaveValue(
      OTHER_TOURNAMENT.regionId,
    );
    expect(screen.getByLabelText(/定員/)).toHaveValue(null);
    expect(screen.getByLabelText('種別')).toHaveValue('shinjinou');
    expect(screen.getByPlaceholderText('スプレッドシートID')).toHaveValue('');
    expect(screen.getByText(/対象: 新人王/)).toBeInTheDocument();
    expect(screen.getByLabelText('YAML')).toHaveValue(
      'tournamentSlug: shinjinou\nfields: []\n',
    );
  });

  // A plain post would load the page afresh, re-seeding the YAML editor
  // from the stored definition and throwing the draft away (#303).
  it('sends every form through `use:enhance`', () => {
    renderPage();

    for (const name of ['更新', '参加者データをリセット', '大会を削除']) {
      const form = screen.getByRole('button', {name}).closest('form');
      expect(enhancedForms.has(form as HTMLFormElement)).toBe(true);
    }
  });

  // The controls take `value` rather than `bind:value`, so a reset would
  // put back what the page was first rendered with.
  it('keeps the tournament form as typed after a save', async () => {
    renderPage();
    const {callback} = await startSubmit('更新');

    const update = await answer(callback, {type: 'success', status: 200});

    expect(update).toHaveBeenCalledExactlyOnceWith({reset: false});
  });

  // `applyAction` would swap the page for `+error.svelte`, and the YAML
  // draft with it.
  it('reports an update action that failed outright on the page', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('YAML'), '# 手で直した');
    const {callback} = await startSubmit('更新');

    const update = await answer(callback, {
      type: 'error',
      error: new Error('fetch failed'),
    });

    expect(update).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        '送信に失敗しました。時間をおいてもう一度お試しください',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('YAML')).toHaveValue(
      `${FORM_DEFINITION_YAML}# 手で直した`,
    );
  });

  it('sends the update once while the first is still out', async () => {
    renderPage();
    const first = await startSubmit('更新');

    expect(screen.getByRole('button', {name: '更新'})).toBeDisabled();
    const second = await startSubmit('更新');
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(first.cancel).not.toHaveBeenCalled();

    await answer(first.callback, {type: 'success', status: 200});
    expect(screen.getByRole('button', {name: '更新'})).toBeEnabled();
  });

  it('clears the reset safeguards after a refused reset', async () => {
    const user = userEvent.setup();
    renderPage({
      ...TOURNAMENT,
      entryOpensAt: '2025-01-01T00:00:00.000Z',
      entryClosesAt: '2025-02-01T00:00:00.000Z',
    });
    await user.click(screen.getByLabelText('参加者アカウントも削除する'));
    await user.type(
      screen.getByLabelText(/確認のため/),
      RESET_CONFIRMATION_WORD,
    );
    const {callback} = await startSubmit('参加者データをリセット');

    await answer(callback, {
      type: 'failure',
      status: 502,
      data: {reset: null, resetError: '参加者データのリセットに失敗しました'},
    });

    expect(
      screen.getByLabelText('参加者アカウントも削除する'),
    ).not.toBeChecked();
    expect(screen.getByLabelText(/確認のため/)).toHaveValue('');
  });

  it('clears the delete tick after a refused delete', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('この大会を削除する'));
    const {callback} = await startSubmit('大会を削除');

    await answer(callback, {
      type: 'failure',
      status: 409,
      data: {deleteError: 'エントリーがある大会は削除できません'},
    });

    expect(screen.getByLabelText('この大会を削除する')).not.toBeChecked();
  });

  it('keeps a refused save on the tournament form across a reset', async () => {
    const values = {
      regionId: TOURNAMENT.regionId,
      type: 'saikyoi' as const,
      name: '直している大会名',
      capacity: '64',
      questionSet: '宮崎',
      entryOpensAt: '2026-01-01T09:00',
      entryClosesAt: '2026-02-01T09:00',
    };
    const {rerender} = renderPage(TOURNAMENT, {
      saved: false,
      error: '問題セットが重複しています',
      values,
      promotion: null,
    });

    await rerender({
      params: {id: TOURNAMENT.id},
      data: {
        staff: STAFF,
        tournament: TOURNAMENT,
        customName: TOURNAMENT.name,
        regions: REGIONS,
        questionSets: QUESTION_SETS,
        hasEntries: false,
        formDefinitionYaml: FORM_DEFINITION_YAML,
      },
      form: {reset: null, resetError: '参加者データのリセットに失敗しました'},
    });

    expect(screen.getByLabelText(/大会名/)).toHaveValue('直している大会名');
    expect(screen.getByText('問題セットが重複しています')).toBeInTheDocument();
  });

  it('keeps an unsaved YAML draft across a saved update', async () => {
    const user = userEvent.setup();
    const {rerender} = renderPage();
    await user.type(screen.getByLabelText('YAML'), '# 手で直した');

    // What the enhanced update leaves behind: `load` re-read, with the
    // saved name, and the action's result.
    await rerender({
      params: {id: TOURNAMENT.id},
      data: {
        staff: STAFF,
        tournament: {...TOURNAMENT, name: '第1回テスト最強位(改)'},
        customName: '第1回テスト最強位(改)',
        regions: REGIONS,
        questionSets: QUESTION_SETS,
        hasEntries: false,
        formDefinitionYaml: FORM_DEFINITION_YAML,
      },
      form: {
        saved: true,
        error: null,
        values: null,
        promotion: {promotedCount: 0, mailFailedCount: 0},
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('更新しました');
    expect(screen.getByLabelText(/大会名/)).toHaveValue(
      '第1回テスト最強位(改)',
    );
    expect(screen.getByLabelText('YAML')).toHaveValue(
      `${FORM_DEFINITION_YAML}# 手で直した`,
    );
  });

  it('starts the YAML editor from the stored form definition', () => {
    renderPage();

    expect(screen.getByLabelText('YAML')).toHaveValue(FORM_DEFINITION_YAML);
  });

  // A refused update must not show up in the delete section, nor the other
  // way round.
  it('keeps the update result out of the delete section', () => {
    renderPage(TOURNAMENT, {
      saved: true,
      error: null,
      values: null,
      promotion: {promotedCount: 0, mailFailedCount: 0},
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('deletes through the page action, behind a required confirmation', () => {
    renderPage();

    const form = screen
      .getByRole('button', {name: '大会を削除'})
      .closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', '?/delete');
    expect(screen.getByLabelText('この大会を削除する')).toBeRequired();
  });

  it('resets through the page action, behind a choice and a typed word', () => {
    renderPage();

    const form = screen
      .getByRole('button', {name: '参加者データをリセット'})
      .closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', '?/reset');
    const keep = screen.getByLabelText('参加者アカウントは残す');
    const remove = screen.getByLabelText('参加者アカウントも削除する');
    expect(keep).toBeRequired();
    expect(keep).not.toBeChecked();
    expect(remove).not.toBeChecked();
    expect(
      screen.getByLabelText('確認のため「リセット」と入力してください'),
    ).toBeRequired();
  });

  it('warns that a bulk mail still being sent goes out after a reset', () => {
    renderPage();

    expect(
      screen.getByText(/一斉メールの送信中にリセットすると/),
    ).toBeInTheDocument();
  });

  it('offers no reset for a tournament in its entry period', () => {
    const now = Date.now();
    renderPage({
      ...TOURNAMENT,
      entryOpensAt: new Date(now - 86_400_000).toISOString(),
      entryClosesAt: new Date(now + 86_400_000).toISOString(),
    });

    expect(
      screen.getByRole('button', {name: '参加者データをリセット'}),
    ).toBeDisabled();
    expect(
      screen.getByText(
        'この大会はエントリー期間中のため、リセットできません。',
      ),
    ).toBeInTheDocument();
  });

  it('lets a tournament outside its entry period be reset', () => {
    renderPage();

    expect(
      screen.getByRole('button', {name: '参加者データをリセット'}),
    ).toBeEnabled();
  });

  it('says what a reset deleted and which accounts it kept', () => {
    renderPage(TOURNAMENT, {
      reset: {
        deletedEntryCount: 5,
        deletedParticipantCount: 3,
        keptParticipantCount: 1,
      },
      resetError: null,
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'エントリーを 5 件削除しました。参加者アカウントを 3 件削除しました。他の大会にエントリーが残っている 1 件の参加者アカウントは残しました。',
    );
  });

  it('says only the entries went when the accounts were kept', () => {
    renderPage(TOURNAMENT, {
      reset: {
        deletedEntryCount: 2,
        deletedParticipantCount: 0,
        keptParticipantCount: 0,
      },
      resetError: null,
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      /^エントリーを 2 件削除しました。$/,
    );
  });

  it('shows why a reset was refused', () => {
    renderPage(TOURNAMENT, {
      reset: null,
      resetError: '参加者データのリセットに失敗しました',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '参加者データのリセットに失敗しました',
    );
  });

  it('shows why a delete was refused, without touching the tournament form', () => {
    renderPage(TOURNAMENT, {
      deleteError: 'エントリーがある大会は削除できません',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'エントリーがある大会は削除できません',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/大会名/)).toHaveValue(TOURNAMENT.name);
  });
});
