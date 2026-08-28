// エントリー登録 → 確認メールのリンクをクリック → マイページで確認

import {expect, test} from '@playwright/test';
import {SHINJINOU} from '../support/fixtures';
import {
  entryFormPath,
  entryListPath,
  fillEntryForm,
  holdClientBundle,
  loginParticipantThroughForm,
  logoutParticipantThroughButton,
  MYPAGE_PATH,
  openVerificationLink,
  PARTICIPANT_LOGIN_PATH,
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
    customFieldValues: {
      shirt_size: 'M',
      note: 'よろしくお願いします',
      workshops: ['早押し', '筆記'],
    },
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

// #95 の回帰テスト。
test('accepts a required checkbox group answered before the client bundle took over', async ({
  page,
}) => {
  // A required checkbox group has no native "at least one checked", so the
  // form spells it as a `required` on every box that is dropped again once
  // one is checked — and dropping it takes a re-render. Held back here, so
  // the whole form is answered and submitted against the server's HTML,
  // exactly as it would be with JS off: the boxes left unchecked must not
  // be carrying a `required` the browser then silently refuses to submit
  // past.
  const releaseClientBundle = await holdClientBundle(page);
  await page.goto(entryFormPath(SHINJINOU), {waitUntil: 'commit'});

  const participant = await fillEntryForm(page, SHINJINOU, {
    displayName: '先回りさん',
    customFieldValues: {shirt_size: 'M', workshops: ['筆記']},
  });
  // Two of the three boxes are unchecked, and the form is submitted with
  // the client bundle still held.
  await page.getByRole('button', {name: 'エントリーする'}).click();

  await expect(page.getByRole('status')).toContainText(participant.email);
  releaseClientBundle();
});

test('logging out ends the session, so mypage asks to log in again', async ({
  page,
}) => {
  const participant = await submitEntryForm(page, SHINJINOU);
  await loginParticipantThroughForm(page, participant);

  await logoutParticipantThroughButton(page);

  // The cookie is gone, not merely unused: coming back to mypage under the
  // same browser session lands on the login form rather than the entries.
  await page.goto(MYPAGE_PATH);
  await expect(page).toHaveURL(PARTICIPANT_LOGIN_PATH);
  // And the layout stops offering a session there is no longer any of.
  await expect(page.getByRole('button', {name: 'ログアウト'})).toHaveCount(0);
});
