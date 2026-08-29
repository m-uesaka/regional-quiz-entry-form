// スタッフの一斉メール送信 → Cloudflare Queues のコンシューマが送信 →
// 送信結果(mail_jobs)の確認

import {expect, test} from '@playwright/test';
import {
  enterAndVerify,
  loginStaff,
  sendBulkMail,
  submitEntry,
  waitForMail,
  waitForMailJob,
} from '../support/api';
import {BACKEND_URL} from '../support/env';
import {SHINJINOU, SHINJINOU_STAFF} from '../support/fixtures';

const MAIL = {
  subject: '【テスト】大会当日のご案内',
  body: '<p>当日は 9:30 集合です。</p>',
};

test('staff mail every entrant of their tournament through the queue', async ({
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
  // Left unverified, because a bulk send with no `statusFilter` goes to
  // every entry but the cancelled ones -- including this one.
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
  const {jobId, accepted} = await sendBulkMail(request, SHINJINOU.id, MAIL);

  // The response only says the recipients were taken on: the messages are
  // still in the queue at this point, and nothing has been sent.
  expect(accepted).toBeGreaterThanOrEqual(2);

  // Which is what makes these two arrivals the end-to-end evidence -- the
  // request that asked for them has long since answered, so they can only
  // have been sent by the queue's consumer.
  for (const recipient of [confirmed, pending]) {
    const mail = await waitForMail(request, recipient.email, MAIL.subject);
    expect(mail.html).toBe(MAIL.body);
    // One message per recipient, so nobody sees anybody else's address.
    expect(mail.to).toEqual([recipient.email]);
  }

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
});
