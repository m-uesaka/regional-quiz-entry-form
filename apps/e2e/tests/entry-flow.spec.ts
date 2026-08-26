// エントリー登録 → 確認メール → マイページ確認

import {expect, test} from '@playwright/test';
import {
  extractVerificationToken,
  loginParticipant,
  readMypageEntries,
  submitEntry,
  waitForMail,
} from '../support/api';
import {SHINJINOU} from '../support/fixtures';

test('an entry is confirmed through its mailed link and shows up on mypage', async ({
  request,
}) => {
  const participant = await submitEntry(request, SHINJINOU, {
    name: '確認太郎',
    furigana: 'かくにんたろう',
    displayName: 'かくにん',
    customFieldValues: {shirt_size: 'M', note: 'よろしくお願いします'},
  });

  // The entry exists but is not on the public list yet: it stays
  // `pending_verification` until the mailed link is followed.
  const beforeVerification = await request.get(
    `/api/tournaments/${SHINJINOU.id}/entry-list`,
  );
  expect(beforeVerification.status()).toBe(200);
  expect(await beforeVerification.json()).not.toContainEqual(
    expect.objectContaining({displayName: participant.displayName}),
  );

  const mail = await waitForMail(request, participant.email);
  expect(mail.subject).toBe('エントリー確認メール');

  const verification = await request.get(
    `/api/entries/verify?token=${extractVerificationToken(mail.html)}`,
  );
  expect(verification.status(), await verification.text()).toBe(200);
  // The tournament is uncapped, so there is always a seat.
  expect(await verification.json()).toEqual({status: 'confirmed'});

  // Mypage is the participant's own view, so it must refuse an anonymous
  // caller rather than fall back to showing nothing.
  const anonymous = await request.get('/api/mypage/entries');
  expect(anonymous.status()).toBe(401);

  await loginParticipant(request, participant);
  const entries = await readMypageEntries(request);
  expect(entries).toEqual([
    expect.objectContaining({
      id: participant.entryId,
      tournamentId: SHINJINOU.id,
      status: 'confirmed',
      waitlistPosition: null,
      tournament: expect.objectContaining({
        name: SHINJINOU.name,
        type: SHINJINOU.type,
      }),
    }),
  ]);
});

test('a one-time verification token cannot be spent twice', async ({
  request,
}) => {
  const participant = await submitEntry(request, SHINJINOU);
  const mail = await waitForMail(request, participant.email);
  const token = extractVerificationToken(mail.html);

  const first = await request.get(`/api/entries/verify?token=${token}`);
  expect(first.status()).toBe(200);

  const second = await request.get(`/api/entries/verify?token=${token}`);
  expect(second.status()).toBe(400);
});
