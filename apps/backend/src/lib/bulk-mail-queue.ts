import type {Bindings} from '../types/env';
import {createDbClient, type DbClient} from './db';
import {MailSendError, createMailSender, type SendMailInput} from './mailer';
import {sendPacedMail, type PacedMailOptions} from './bulk-mail';
import {
  discardVerificationToken,
  prepareVerificationResend,
} from './entry-verification';
import {
  handleDeferredEntryMail,
  isDeferredEntryMail,
  type DeferredEntryMailMessage,
} from './deferred-entry-mail';
import {
  fetchMailJobContent,
  recordMailJobProgress,
  type MailJobContent,
} from './mail-jobs';

/**
 * One message of the bulk mail queue: a recipient of a staff bulk send, an
 * entry a staff reminder re-sends the confirmation mail to, or the mail of
 * an entry submitted while its address was over its limit (#346).
 */
export type BulkMailMessage = JobMailMessage | DeferredEntryMailMessage;

/** A message of a staff send or reminder, counted on its `mail_jobs` row. */
export type JobMailMessage = StaffMailMessage | VerificationResendMessage;

/**
 * One recipient of one staff bulk send.
 *
 * The subject and body are deliberately *not* in here: Cloudflare caps a
 * queue message at 128 KB and a `sendBatch()` call at 256 KB, while a
 * staff-composed body may be 20 000 characters on its own, so a copy per
 * recipient would put a list of a few dozen over the limit. The content
 * lives in the `mail_jobs` row `jobId` names and is read back once per
 * batch.
 */
export interface StaffMailMessage {
  jobId: string;
  to: string;
}

/**
 * One entry a staff reminder re-sends the confirmation mail to (#192).
 *
 * Carries the entry rather than an address and a link: the link's token is
 * issued by the consumer just before the mail goes out, so no usable token
 * ever sits in the queue (or its dead letter queue), and an entry that was
 * confirmed in the meantime gets nothing.
 */
export interface VerificationResendMessage {
  jobId: string;
  entryId: string;
}

function isVerificationResend(
  message: JobMailMessage,
): message is VerificationResendMessage {
  return 'entryId' in message;
}

/**
 * How many times a message may be delivered to this consumer in total,
 * i.e. the first delivery plus the retries.
 *
 * This mirrors `max_retries` on the consumer in `wrangler.toml` and has to
 * be kept in step with it. It is here so that the last delivery ends the
 * recipient one way or the other: a message this consumer sends back on
 * its final attempt is moved to the dead letter queue by the platform, and
 * a `mail_jobs` row whose `sent + failed` never reaches `total` would leave
 * the staff screen showing a send that looks stuck forever.
 */
export const MAIL_QUEUE_MAX_ATTEMPTS = 4;

/**
 * How long a message sent back for a failure of the attempt rather than of
 * the message waits before its first redelivery; each later one waits twice
 * as long as the one before (`queueRetryDelaySeconds()`).
 *
 * The failures that get here are of two kinds. A throttle has already been
 * waited out once in `sendPacedMail()` (the provider's `Retry-After` and
 * its own backoff), so what is left is a quota that outlived those. A
 * provider fault (5xx), a timeout or a network error comes straight here
 * with no wait at all. Either way the useful answer is to stand back rather
 * than come straight back, and to stand back further each time: with
 * `MAIL_QUEUE_MAX_ATTEMPTS` deliveries, waits of 30, 60 and 120 seconds see
 * a message through an outage of about three and a half minutes, where a
 * fixed 30 would give up after ninety seconds. The queue holds the message
 * meanwhile, so nothing is occupying the consumer during the wait.
 */
export const MAIL_QUEUE_RETRY_DELAY_SECONDS = 30;

/**
 * How long to wait before redelivering a message on its `attempts`-th
 * delivery: `MAIL_QUEUE_RETRY_DELAY_SECONDS`, doubled for each delivery
 * before this one.
 * @param attempts The delivery that failed, counting from 1, as
 *     `Message.attempts` does.
 */
export function queueRetryDelaySeconds(attempts: number): number {
  return MAIL_QUEUE_RETRY_DELAY_SECONDS * 2 ** Math.max(0, attempts - 1);
}

/** Running total of what a batch did to one job's counters. */
interface JobProgress {
  sent: number;
  failed: number;
}

/**
 * The tally a batch is accumulating for one job, created on first use.
 * @param progress The tallies collected so far, keyed by job id.
 * @param jobId The job to count against.
 */
function tallyOf(
  progress: Map<string, JobProgress>,
  jobId: string,
): JobProgress {
  const tally = progress.get(jobId) ?? {sent: 0, failed: 0};
  progress.set(jobId, tally);
  return tally;
}

/**
 * Whether `error` is a failure of this attempt rather than a refusal of the
 * address.
 *
 * A throttle, a fault on the provider's side (5xx) or a send that got no
 * answer says nothing about the recipient, so the message goes back to the
 * queue; anything else -- an address the provider rejects, a body it will
 * not accept -- would be rejected again just the same on every redelivery,
 * so it is given up on instead of being retried until the dead letter queue
 * catches it.
 */
function isRetryable(error: unknown): boolean {
  return error instanceof MailSendError && error.isTransient();
}

/**
 * Reads the content of every job named in the batch, once per job.
 *
 * A batch can hold messages from more than one bulk send (two staff
 * members sending at the same time), so the jobs are collected first and
 * looked up once each rather than once per message.
 * @param db The database client.
 * @param messages The batch being handled.
 * @returns The content of each job that could be read. A job whose row is
 *     missing is absent from the map; a job whose lookup failed is
 *     reported in `unreadable`, since those messages have to be delivered
 *     again rather than dropped.
 */
async function fetchBatchJobs(
  db: DbClient,
  messages: ReadonlyArray<{body: JobMailMessage}>,
): Promise<{
  contents: Map<string, MailJobContent>;
  unreadable: Set<string>;
}> {
  const contents = new Map<string, MailJobContent>();
  const unreadable = new Set<string>();

  for (const jobId of new Set(messages.map(message => message.body.jobId))) {
    const result = await fetchMailJobContent(db, jobId);
    if (!result.ok) {
      console.error('failed to read a bulk mail job', {
        jobId,
        error: result.error,
      });
      unreadable.add(jobId);
      continue;
    }
    if (result.value === null) {
      // The row is gone, so there is nothing to send and no counter to
      // move. Redelivering would only meet the same missing row.
      console.error('bulk mail job no longer exists', {jobId});
      continue;
    }
    contents.set(jobId, result.value);
  }

  return {contents, unreadable};
}

/**
 * Sends one batch of the bulk mail queue.
 *
 * This is where a staff bulk send actually happens. The HTTP route only
 * works out the recipients and enqueues them, so the number of recipients
 * is no longer bounded by what fits in the request's post-response budget:
 * each consumer invocation gets its own execution time, and the messages
 * are paced against the mail provider's rate limit exactly as the
 * in-request send used to be.
 *
 * Every message is settled explicitly rather than by letting the handler
 * return: delivered and permanently rejected messages are acked -- the
 * rejected ones counted as failures on their job -- while a message whose
 * send failed only for now (a throttle, a provider fault, a network error)
 * is sent back for another delivery. Acking the batch as a whole would
 * either re-send the delivered messages along with the failed ones or drop
 * the failed ones with the rest.
 * @param batch The messages the queue delivered.
 * @param env The Worker bindings.
 * @param options Overrides for the pacing, for tests.
 */
export async function handleBulkMailQueue(
  batch: MessageBatch<BulkMailMessage>,
  env: Bindings,
  options: PacedMailOptions = {},
): Promise<void> {
  // The deferred entry mails belong to no job and are settled on their own
  // terms (`lib/deferred-entry-mail.ts`); everything below is about jobs.
  // The one client every read and write of this invocation shares (#310).
  const db = createDbClient(env);
  const deferred: Array<Message<DeferredEntryMailMessage>> = [];
  const jobMessages: Array<Message<JobMailMessage>> = [];
  for (const message of batch.messages) {
    if (isDeferredEntryMail(message.body)) {
      deferred.push(message as Message<DeferredEntryMailMessage>);
    } else {
      jobMessages.push(message as Message<JobMailMessage>);
    }
  }
  if (deferred.length > 0) {
    await handleDeferredEntryMail(deferred, env, db);
  }
  if (jobMessages.length === 0) {
    return;
  }

  const {contents, unreadable} = await fetchBatchJobs(db, jobMessages);

  // Only the messages there is something to send for reach the mailer;
  // `sendable` keeps each one's place so the outcomes can be matched back
  // to the queue messages they belong to.
  const sendable: Array<Message<JobMailMessage>> = [];
  const inputs: SendMailInput[] = [];
  // The token each reminder's link names, by its place in `sendable`.
  const issuedTokens = new Map<number, string>();
  const progress = new Map<string, JobProgress>();

  // A message that failed for a reason of this attempt rather than of the
  // message -- its job's row or its entry could not be read, or the send
  // met a throttle, a provider fault or a network error -- is tried again
  // later. On the last delivery a retry would hand it to the dead letter
  // queue with nothing added to either counter, and the job would read as
  // still sending for good (`attempts` counts this delivery). An outage
  // long enough to burn every delivery is one the recipient is not going to
  // survive anyway, so it is closed out as failed instead.
  const retryOrFail = (message: Message<JobMailMessage>) => {
    if (message.attempts < MAIL_QUEUE_MAX_ATTEMPTS) {
      message.retry({delaySeconds: queueRetryDelaySeconds(message.attempts)});
      return;
    }
    tallyOf(progress, message.body.jobId).failed++;
    message.ack();
  };

  for (const message of jobMessages) {
    const content = contents.get(message.body.jobId);
    if (!content) {
      if (unreadable.has(message.body.jobId)) {
        retryOrFail(message);
      } else {
        message.ack();
      }
      continue;
    }

    if (!isVerificationResend(message.body)) {
      sendable.push(message);
      inputs.push({
        to: message.body.to,
        subject: content.subject,
        html: content.bodyHtml,
        // The queue's id for the message is the same on every delivery, and
        // so is the body read from the job's row: a redelivery after an
        // answer that was lost on its way back sends nothing the second time.
        idempotencyKey: `bulk-mail/${message.id}`,
      });
      continue;
    }

    // The job's row holds no body for a reminder: each mail carries its
    // own link, issued here.
    const prepared = await prepareVerificationResend(
      env,
      db,
      message.body.entryId,
    );
    if (!prepared.ok) {
      console.error('failed to prepare a verification resend', {
        jobId: message.body.jobId,
        entryId: message.body.entryId,
        error: prepared.error,
      });
      retryOrFail(message);
      continue;
    }
    if (prepared.value === null) {
      // Confirmed, cancelled, or given a live link since the reminder was
      // asked for. Counted as failed -- "not sent" -- so the job still adds
      // up to its total.
      tallyOf(progress, message.body.jobId).failed++;
      message.ack();
      continue;
    }
    issuedTokens.set(sendable.length, prepared.value.tokenId);
    sendable.push(message);
    // Keyed by the link rather than the message: each delivery issues a new
    // link, so a body that differs from the last delivery's would be refused
    // under the same key. This covers the retries `sendPacedMail()` makes
    // within the delivery; a redelivery after a lost answer can still mail
    // the participant twice, and the first link -- discarded as undelivered
    // -- no longer works.
    inputs.push({
      ...prepared.value.mail,
      idempotencyKey: `verification-resend/${prepared.value.tokenId}`,
    });
  }

  const outcomes = await sendPacedMail(createMailSender(env), inputs, options);

  // A reminder's link that never went out must not count as live, or the
  // retry below -- and every later reminder -- would pass the entry over.
  // A reminder whose link could not be discarded is not retried (#343): its
  // redelivery would find that link still live, send nothing and close the
  // message out as failed anyway, so it is settled as failed here, where
  // the log can say why.
  const undiscarded = new Set<number>();
  for (const [index, tokenId] of issuedTokens) {
    if (outcomes[index].ok) {
      continue;
    }
    const discarded = await discardVerificationToken(db, tokenId);
    if (!discarded.ok) {
      console.error('failed to discard an undelivered verification token', {
        jobId: sendable[index].body.jobId,
        error: discarded.error,
      });
      undiscarded.add(index);
    }
  }

  outcomes.forEach((outcome, index) => {
    const message = sendable[index];
    const tally = tallyOf(progress, message.body.jobId);

    if (outcome.ok) {
      tally.sent++;
      message.ack();
      return;
    }
    // Only this message goes back: the rest of the batch is acked on its
    // own outcome, so a redelivery neither re-sends to the recipients that
    // were mailed nor counts a failure twice -- a retried message adds to
    // neither counter until a later delivery settles it. On the last
    // delivery `retryOrFail()` closes it out as failed rather than leaving
    // the job short of `total` in the dead letter queue.
    if (isRetryable(outcome.error)) {
      if (!undiscarded.has(index)) {
        retryOrFail(message);
        return;
      }
      console.error(
        'giving up on a verification resend whose undelivered link is still live',
        {jobId: message.body.jobId, messageId: message.id},
      );
    }
    tally.failed++;
    message.ack();
  });

  // Best effort, and deliberately after the sends: the counters are what
  // the staff screen reads, not what decides whether a recipient is mailed
  // again, so a failure here is logged rather than allowed to throw --
  // throwing would have the platform redeliver the whole batch, re-sending
  // mail that already went out.
  for (const [jobId, tally] of progress) {
    if (tally.sent === 0 && tally.failed === 0) {
      continue;
    }
    const result = await recordMailJobProgress(db, jobId, tally);
    if (!result.ok) {
      console.error('failed to record bulk mail job progress', {
        jobId,
        error: result.error,
      });
    }
  }
}
