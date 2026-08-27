// エントリー登録 → 確認メールのリンクをクリック → マイページで確認

import {expect, test} from '@playwright/test';
import {SHINJINOU} from '../support/fixtures';
import {
  entryFormPath,
  entryListPath,
  holdClientBundle,
  loginParticipantThroughForm,
  openVerificationLink,
  submitEntryForm,
} from '../support/ui';

test('an entry is confirmed through its mailed link and shows up on mypage', async ({
  page,
  request,
}) => {
  const participant = await submitEntryForm(page, SHINJINOU, {
    name: '確認太郎',
    furigana: 'かくにんたろう',
    displayName: 'かくにん',
    customFieldValues: {shirt_size: 'M', note: 'よろしくお願いします'},
    freeText: '当日は早めに伺います',
  });

  // The entry exists but is not on the public list yet: it stays
  // `pending_verification` until the mailed link is followed.
  await page.goto(entryListPath(SHINJINOU));
  await expect(page.getByText(participant.displayName)).toHaveCount(0);

  await openVerificationLink(page, request, participant.email);
  // The tournament is uncapped, so there is always a seat.
  await expect(page.getByText('エントリーが確定しました。')).toBeVisible();
  // The token is spent by the time the page renders: `/verify` carries the
  // outcome into a token-less URL so a reload doesn't re-send it.
  await expect(page).toHaveURL('/verify?status=confirmed');

  await loginParticipantThroughForm(page, participant);
  await expect(
    page.getByRole('heading', {name: SHINJINOU.name, level: 2}),
  ).toBeVisible();
  await expect(page.getByText('ステータス: confirmed')).toBeVisible();

  // Confirmed, so the entry is now the participant's public listing too.
  await page.goto(entryListPath(SHINJINOU));
  await expect(
    page.getByRole('listitem').filter({hasText: participant.displayName}),
  ).toHaveCount(1);
});

test('a verification link cannot be followed twice', async ({
  page,
  request,
}) => {
  const participant = await submitEntryForm(page, SHINJINOU, {
    displayName: '二度目さん',
  });

  const link = await openVerificationLink(page, request, participant.email);
  await expect(page.getByText('エントリーが確定しました。')).toBeVisible();

  await page.goto(link);
  await expect(page.getByText('この確認リンクは無効です。')).toBeVisible();
});

// #90 の回帰テスト。
test('keeps what was answered before the client bundle took over', async ({
  page,
}) => {
  // Held until the form has been answered, so hydration is guaranteed to
  // land after the typing instead of only doing so on a slow machine.
  const releaseClientBundle = await holdClientBundle(page);
  await page.goto(entryFormPath(SHINJINOU), {waitUntil: 'commit'});

  const name = page.getByLabel('氏名', {exact: true});
  await name.fill('先走り太郎');
  const regulation = page
    .getByRole('group', {name: 'レギュレーションを選択してください'})
    .getByLabel(SHINJINOU.regulationLabel, {exact: true});
  await regulation.check();

  releaseClientBundle();
  // Waits for the hydration the answers above raced, so that what follows
  // is asserted against a hydrated page rather than against the server's
  // HTML — a wait that gives the bug every chance to happen, the opposite
  // of the one #90 removed.
  //
  // SvelteKit publishes no hydration signal, but Svelte's own hydration
  // does: `remove_input_defaults()` drops the `value` attribute from every
  // bound input while keeping the property, so the attribute going away is
  // the client bundle taking this form over. `networkidle` would only say
  // the modules arrived, which is not the same as their having run.
  await expect(name).not.toHaveAttribute('value');

  await expect(name).toHaveValue('先走り太郎');
  await expect(regulation).toBeChecked();
});
