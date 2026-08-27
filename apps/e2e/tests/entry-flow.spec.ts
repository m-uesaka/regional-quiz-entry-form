// エントリー登録 → 確認メールのリンクをクリック → マイページで確認

import {expect, test} from '@playwright/test';
import {SHINJINOU} from '../support/fixtures';
import {
  entryListPath,
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
