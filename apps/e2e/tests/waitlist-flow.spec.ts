// 定員超過時のキャンセル待ち登録 → キャンセル発生 → 繰り上げ確認
//
// `SAIKYOI` is seeded with a single seat, and no other spec enters it, so
// the second confirmed entry is guaranteed to land on the waitlist.

import {expect, test, type APIRequestContext} from '@playwright/test';
import {
  enterAndVerify,
  loginParticipant,
  newApiContext,
  readMypageEntries,
  waitForMail,
  type EnteredParticipant,
} from '../support/api';
import {SAIKYOI} from '../support/fixtures';

const PROMOTION_MAIL_SUBJECT = 'キャンセル待ちからの繰り上げについて';

/**
 * Reads one participant's own entry.
 * @param request An API context carrying that participant's session.
 * @param participant The participant whose entry is read.
 */
async function readOwnEntry(
  request: APIRequestContext,
  participant: EnteredParticipant,
) {
  const entries = await readMypageEntries(request);
  const entry = entries.find(candidate => candidate.id === participant.entryId);
  if (!entry) {
    throw new Error(
      `${participant.email} has no entry ${participant.entryId}; mypage ` +
        `returned ${JSON.stringify(entries)}`,
    );
  }
  return entry;
}

test('a cancellation promotes the waitlisted entry behind it', async ({
  request,
  playwright,
}) => {
  const first = await enterAndVerify(request, SAIKYOI, {
    displayName: '先着さん',
  });
  expect(first.status).toBe('confirmed');

  // The single seat is taken, so this one is queued rather than refused.
  const second = await enterAndVerify(request, SAIKYOI, {
    displayName: '待機さん',
  });
  expect(second.status).toBe('waitlisted');

  const publicList = await request.get(
    `/api/tournaments/${SAIKYOI.id}/entry-list`,
  );
  expect(publicList.status()).toBe(200);
  expect(await publicList.json()).toEqual([
    {displayName: '先着さん', status: 'confirmed', waitlistPosition: null},
    {displayName: '待機さん', status: 'waitlisted', waitlistPosition: 1},
  ]);

  const firstContext = await newApiContext(playwright);
  const secondContext = await newApiContext(playwright);
  try {
    await loginParticipant(firstContext, first);
    await loginParticipant(secondContext, second);
    expect((await readOwnEntry(secondContext, second)).waitlistPosition).toBe(
      1,
    );

    const cancellation = await firstContext.delete(
      `/api/mypage/entries/${first.entryId}`,
    );
    expect(cancellation.status(), await cancellation.text()).toBe(200);

    // The promotion happens inside the cancelling request (see
    // `cancelOwnEntry()`), so the freed seat is already the second
    // participant's by the time the delete answers.
    const promoted = await readOwnEntry(secondContext, second);
    expect(promoted.status).toBe('confirmed');
    expect(promoted.waitlistPosition).toBeNull();

    expect((await readOwnEntry(firstContext, first)).status).toBe('cancelled');
  } finally {
    await firstContext.dispose();
    await secondContext.dispose();
  }

  // The promoted participant is told, rather than having to notice on
  // their own.
  const notification = await waitForMail(
    request,
    second.email,
    PROMOTION_MAIL_SUBJECT,
  );
  expect(notification.html).toContain('エントリーが確定しました');

  // The cancelled entry keeps its row but loses its name, and the promoted
  // one no longer shows a queue position.
  const listAfterCancellation = await request.get(
    `/api/tournaments/${SAIKYOI.id}/entry-list`,
  );
  expect(await listAfterCancellation.json()).toEqual([
    {displayName: 'キャンセル', status: 'cancelled', waitlistPosition: null},
    {displayName: '待機さん', status: 'confirmed', waitlistPosition: null},
  ]);
});
