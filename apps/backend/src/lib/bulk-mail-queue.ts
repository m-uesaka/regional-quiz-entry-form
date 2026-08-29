import type {Bindings} from '../types/env';
import {MailSendError, createMailSender, type SendMailInput} from './mailer';
import {sendPacedMail, type PacedMailOptions} from './bulk-mail';
import {
  fetchMailJobContent,
  recordMailJobProgress,
  type MailJobContent,
} from './mail-jobs';

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
export interface BulkMailMessage {
  jobId: string;
  to: string;
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
 * How long a throttled message waits before being delivered again.
 *
 * `sendPacedMail()` has already waited out the provider's `Retry-After`
 * and its own backoff by the time a message gets here, so what is left is
 * a throttle that outlived those -- the shared quota is spent, and the
 * useful answer is to stand back for a while rather than to come straight
 * back. The queue holds the message meanwhile, so nothing is occupying the
 * consumer during the wait.
 */
export const MAIL_QUEUE_RETRY_DELAY_SECONDS = 30;

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
 * Whether `error` is the provider throttling us rather than refusing the
 * address.
 *
 * A throttle says nothing about the recipient, so the message goes back to
 * the queue; anything else -- an address the provider rejects, a body it
 * will not accept -- would be rejected again just the same on every
 * redelivery, so it is given up on instead of being retried until the dead
 * letter queue catches it.
 */
function isRetryable(error: unknown): boolean {
  return error instanceof MailSendError && error.isRateLimited();
}

/**
 * Reads the content of every job named in the batch, once per job.
 *
 * A batch can hold messages from more than one bulk send (two staff
 * members sending at the same time), so the jobs are collected first and
 * looked up once each rather than once per message.
 * @param env The Worker bindings.
 * @param messages The batch being handled.
 * @returns The content of each job that could be read. A job whose row is
 *     missing is absent from the map; a job whose lookup failed is
 *     reported in `unreadable`, since those messages have to be delivered
 *     again rather than dropped.
 */
async function fetchBatchJobs(
  env: Bindings,
  messages: ReadonlyArray<{body: BulkMailMessage}>,
): Promise<{
  contents: Map<string, MailJobContent>;
  unreadable: Set<string>;
}> {
  const contents = new Map<string, MailJobContent>();
  const unreadable = new Set<string>();

  for (const jobId of new Set(messages.map(message => message.body.jobId))) {
    const result = await fetchMailJobContent(env, jobId);
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
 * rejected ones counted as failures on their job -- while a message the
 * provider merely throttled is sent back for another delivery. Acking the
 * batch as a whole would either re-send the delivered messages along with
 * the throttled ones or drop the throttled ones with the rest.
 * @param batch The messages the queue delivered.
 * @param env The Worker bindings.
 * @param options Overrides for the pacing, for tests.
 */
export async function handleBulkMailQueue(
  batch: MessageBatch<BulkMailMessage>,
  env: Bindings,
  options: PacedMailOptions = {},
): Promise<void> {
  const {contents, unreadable} = await fetchBatchJobs(env, batch.messages);

  // Only the messages there is something to send for reach the mailer;
  // `sendable` keeps each one's place so the outcomes can be matched back
  // to the queue messages they belong to.
  const sendable: Array<Message<BulkMailMessage>> = [];
  const inputs: SendMailInput[] = [];
  const progress = new Map<string, JobProgress>();

  for (const message of batch.messages) {
    const content = contents.get(message.body.jobId);
    if (!content) {
      if (!unreadable.has(message.body.jobId)) {
        message.ack();
      } else if (message.attempts < MAIL_QUEUE_MAX_ATTEMPTS) {
        // The job's row could not be read, which is a fault of this
        // attempt rather than of the message: try again later.
        message.retry({delaySeconds: MAIL_QUEUE_RETRY_DELAY_SECONDS});
      } else {
        // Same reasoning as the send failure below: `attempts` counts this
        // delivery, so a retry on the last one hands the message to the
        // dead letter queue with nothing added to either counter, and the
        // job would read as still sending for good. An outage long enough
        // to burn every delivery is one the recipient is not going to
        // survive anyway, so it is closed out as failed.
        tallyOf(progress, message.body.jobId).failed++;
        message.ack();
      }
      continue;
    }
    sendable.push(message);
    inputs.push({
      to: message.body.to,
      subject: content.subject,
      html: content.bodyHtml,
    });
  }

  const outcomes = await sendPacedMail(createMailSender(env), inputs, options);

  outcomes.forEach((outcome, index) => {
    const message = sendable[index];
    const tally = tallyOf(progress, message.body.jobId);

    if (outcome.ok) {
      tally.sent++;
      message.ack();
      return;
    }
    // `attempts` counts this delivery, so on the last one a retry would
    // hand the message to the dead letter queue and leave the job's
    // counters short of `total` for good. Record it as failed instead:
    // the message is no better off going round again, and the staff screen
    // gets a job that adds up.
    if (
      isRetryable(outcome.error) &&
      message.attempts < MAIL_QUEUE_MAX_ATTEMPTS
    ) {
      message.retry({delaySeconds: MAIL_QUEUE_RETRY_DELAY_SECONDS});
      return;
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
    const result = await recordMailJobProgress(env, jobId, tally);
    if (!result.ok) {
      console.error('failed to record bulk mail job progress', {
        jobId,
        error: result.error,
      });
    }
  }
}
