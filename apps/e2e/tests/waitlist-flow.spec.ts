// 定員超過時のキャンセル待ち登録 → キャンセル発生 → 繰り上げ確認
//
// `SAIKYOI` is seeded with a single seat, and no other spec enters it, so
// the second confirmed entry is guaranteed to land on the waitlist.

import {expect, test} from '@playwright/test';
import {waitForMail} from '../support/api';
import {FRONTEND_URL} from '../support/env';
import {SAIKYOI} from '../support/fixtures';
import {
  cancelEntryThroughMypage,
  entryListPath,
  loginParticipantThroughForm,
  openVerificationLink,
  submitEntryForm,
} from '../support/ui';

const PROMOTION_MAIL_SUBJECT = 'キャンセル待ちからの繰り上げについて';

test('a cancellation promotes the waitlisted entry behind it', async ({
  page,
  browser,
  request,
}) => {
  // The two participants hold different session cookies, so the second one
  // needs a browser context of its own. `browser.newContext()` inherits
  // nothing from the config, hence the explicit origin for its relative
  // paths.
  const waitlistedContext = await browser.newContext({baseURL: FRONTEND_URL});
  try {
    const waitlistedPage = await waitlistedContext.newPage();

    const seated = await submitEntryForm(page, SAIKYOI, {
      displayName: '先着さん',
    });
    await openVerificationLink(page, request, seated.email);
    await expect(page.getByText('エントリーが確定しました。')).toBeVisible();

    // The single seat is taken, so this one is queued rather than refused.
    const queued = await submitEntryForm(waitlistedPage, SAIKYOI, {
      displayName: '待機さん',
    });
    await openVerificationLink(waitlistedPage, request, queued.email);
    await expect(
      waitlistedPage.getByText(
        '定員に達していたため、キャンセル待ちになりました。',
      ),
    ).toBeVisible();

    await page.goto(entryListPath(SAIKYOI));
    // Strings rather than regexes: `toHaveText` normalizes the whitespace
    // the template leaves between the name and the queue position only when
    // it is comparing against a string.
    await expect(page.getByRole('listitem')).toHaveText([
      '先着さん',
      '待機さん (キャンセル待ち 1)',
    ]);

    await loginParticipantThroughForm(waitlistedPage, queued);
    await expect(
      waitlistedPage.getByText('ステータス: waitlisted'),
    ).toBeVisible();

    await loginParticipantThroughForm(page, seated);
    await cancelEntryThroughMypage(page);
    await expect(page.getByText('ステータス: cancelled')).toBeVisible();

    // The promotion happens inside the cancelling request (see
    // `cancelOwnEntry()`), so the freed seat is already the queued
    // participant's the next time their mypage is loaded.
    await waitlistedPage.reload();
    await expect(
      waitlistedPage.getByText('ステータス: confirmed'),
    ).toBeVisible();

    // And they are told, rather than having to notice on their own.
    const notification = await waitForMail(
      request,
      queued.email,
      PROMOTION_MAIL_SUBJECT,
    );
    expect(notification.html).toContain('エントリーが確定しました');

    // The cancelled entry keeps its row but loses its name, and the
    // promoted one no longer shows a queue position.
    await page.goto(entryListPath(SAIKYOI));
    await expect(page.getByRole('listitem')).toHaveText([
      'キャンセル',
      '待機さん',
    ]);
  } finally {
    await waitlistedContext.close();
  }
});
