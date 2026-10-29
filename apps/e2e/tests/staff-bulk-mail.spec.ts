// スタッフの一斉メール送信 → Cloudflare Queues のコンシューマが送信 →
// 送信結果(mail_jobs)の確認。未確認のエントリーへの確認メール再送も同じ
// キューを通る

import {expect, test} from '@playwright/test';
import {
  enterAndVerify,
  extractVerificationUrl,
  loginStaff,
  readMails,
  resendVerificationMail,
  sendBulkMail,
  submitEntry,
  verificationMailSubject,
  verifyEntry,
  waitForMail,
  waitForMailJob,
} from '../support/api';
import {
  countDefaultMailRecipients,
  expireVerificationLinks,
} from '../support/db';
import {BACKEND_URL} from '../support/env';
import {SHINJINOU, SHINJINOU_STAFF} from '../support/fixtures';

const MAIL = {
  subject: '【テスト】大会当日のご案内',
  body: '<p>当日は 9:30 集合です。</p>',
};

test('staff mail the confirmed entrants of their tournament through the queue', async ({
  request,
}) => {
  // Arranged through the API: this spec is about what happens after the
  // send is asked for, and the participant side is driven through the
  // browser by `entry-flow.spec.ts`.
  const confirmed = await enterAndVerify(request, SHINJINOU, {
    name: '受信太郎',
    displayName: 'たろう',
  });
  expect(confirmed.status).toBe('confirmed');
  // Left unverified, because a bulk send with no `statusFilter` must pass
  // this one over: its address may be a stranger's (#192).
  const pending = await submitEntry(request, SHINJINOU, {
    name: '未確認花子',
    displayName: 'はなこ',
  });

  // The endpoint reaches every participant's address, so it is closed to a
  // caller without a staff session.
  const anonymous = await request.post(
    `${BACKEND_URL}/api/staff/tournaments/${SHINJINOU.id}/mail`,
    {data: MAIL},
  );
  expect(anonymous.status(), await anonymous.text()).toBe(401);

  await loginStaff(request, SHINJINOU_STAFF);
  // Taken just before the send: `workers: 1` keeps any other spec from
  // entering the tournament in between, so this is exactly who it must
  // reach. Were the unconfirmed entry mailed too, `accepted` would come out
  // one higher.
  const expected = await countDefaultMailRecipients(SHINJINOU.id);
  const {jobId, accepted} = await sendBulkMail(request, SHINJINOU.id, MAIL);

  // The response only says the recipients were taken on: the messages are
  // still in the queue at this point, and nothing has been sent.
  expect(accepted).toBe(expected);

  // Which is what makes this arrival the end-to-end evidence -- the request
  // that asked for it has long since answered, so it can only have been
  // sent by the queue's consumer.
  const mail = await waitForMail(request, confirmed.email, MAIL.subject);
  expect(mail.html).toBe(MAIL.body);
  // One message per recipient, so nobody sees anybody else's address.
  expect(mail.to).toEqual([confirmed.email]);

  // And the job is where staff read how it went, which used to exist only
  // as a line in the Worker's log (Task 10-4).
  const job = await waitForMailJob(request, SHINJINOU.id, jobId);
  expect(job).toMatchObject({
    jobId,
    subject: MAIL.subject,
    total: accepted,
    sent: accepted,
    failed: 0,
  });
  // The job has finished, so a message to the unconfirmed address would
  // already be in the sink: its absence now is the answer.
  const toPending = await readMails(request, pending.email);
  expect(toPending.map(received => received.subject)).not.toContain(
    MAIL.subject,
  );

  // Nor can staff reach the unconfirmed by naming them: what they write
  // never goes to an address nobody confirmed (#192).
  const refused = await request.post(
    `${BACKEND_URL}/api/staff/tournaments/${SHINJINOU.id}/mail`,
    {data: {...MAIL, statusFilter: 'pending_verification'}},
  );
  expect(refused.status(), await refused.text()).toBe(400);
});

test('staff remind the unconfirmed with a fresh confirmation link', async ({
  request,
}) => {
  const pending = await submitEntry(request, SHINJINOU, {
    name: '催促花子',
    displayName: 'はなこ',
  });
  const subject = verificationMailSubject(SHINJINOU);
  const verificationMails = async () =>
    (await readMails(request, pending.email)).filter(
      received => received.subject === subject,
    );
  await loginStaff(request, SHINJINOU_STAFF);

  // Its link still works, so it already holds a usable mail and is passed
  // over. The job is waited out before looking, so a mail it was going to
  // send would be in the sink by then.
  const early = await resendVerificationMail(request, SHINJINOU.id);
  await waitForMailJob(request, SHINJINOU.id, early.jobId);
  expect(await verificationMails()).toHaveLength(1);

  // Once the link has run out, the reminder sends a new one.
  await expireVerificationLinks(pending.email);
  const reminder = await resendVerificationMail(request, SHINJINOU.id);
  expect(reminder.accepted).toBeGreaterThanOrEqual(1);
  const job = await waitForMailJob(request, SHINJINOU.id, reminder.jobId);
  expect(job).toMatchObject({subject, failed: 0});

  const [resent, original] = await verificationMails();
  expect(original).toBeDefined();
  // A link of its own: the token is issued when the reminder goes out.
  expect(extractVerificationUrl(resent.html)).not.toBe(
    extractVerificationUrl(original.html),
  );
  // And it is the one that works: the newest mail's link confirms the
  // entry, where the expired one no longer could.
  expect(['confirmed', 'waitlisted']).toContain(
    await verifyEntry(request, SHINJINOU, pending.email),
  );
});
