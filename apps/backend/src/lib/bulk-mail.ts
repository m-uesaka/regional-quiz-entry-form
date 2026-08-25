import type {MailSender} from './mailer';

// Rate control for a bulk send: at most `MAIL_BATCH_SIZE` messages are in
// flight at once, and consecutive batches are spaced by
// `MAIL_BATCH_INTERVAL_MS`. Mail providers rate-limit by requests per
// second, so firing a whole tournament's worth of `send()` calls at once
// would have the tail of them rejected. The batch size also stays under the
// number of simultaneous outbound connections a Worker invocation may hold
// open, past which the extra sends would only queue anyway.
export const MAIL_BATCH_SIZE = 5;
export const MAIL_BATCH_INTERVAL_MS = 1000;

export interface BulkMailContent {
  subject: string;
  html: string;
}

export interface BulkMailOptions {
  batchSize?: number;
  intervalMs?: number;
}

export interface BulkMailResult {
  sent: number;
  /** The recipients whose send was rejected, in the given order. */
  failed: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Sends the same message to every recipient, one message per recipient, in
 * rate-controlled batches.
 *
 * Each recipient is mailed individually so no one sees anybody else's
 * address. A recipient the mail provider rejects is collected into
 * `failed` instead of aborting the run, so one bad address can't stop the
 * rest of a tournament from being notified.
 * @param mailer The mail sender to send through.
 * @param recipients The addresses to mail; duplicates are mailed twice, so
 *     de-duplicate before calling.
 * @param content The subject and HTML body every recipient receives.
 * @param options Overrides for the batch size and inter-batch wait.
 */
export async function sendBulkMail(
  mailer: MailSender,
  recipients: readonly string[],
  content: BulkMailContent,
  options: BulkMailOptions = {},
): Promise<BulkMailResult> {
  const batchSize = options.batchSize ?? MAIL_BATCH_SIZE;
  const intervalMs = options.intervalMs ?? MAIL_BATCH_INTERVAL_MS;

  let sent = 0;
  const failed: string[] = [];

  for (let start = 0; start < recipients.length; start += batchSize) {
    if (start > 0) {
      await sleep(intervalMs);
    }

    const batch = recipients.slice(start, start + batchSize);
    const results = await Promise.allSettled(
      batch.map(to => mailer.send({to, ...content})),
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sent++;
        return;
      }
      failed.push(batch[index]);
      // The address itself is deliberately kept out of the log -- which
      // addresses bounced is the mail provider's delivery log to answer,
      // and repeating it here would put participant addresses in the
      // Worker's logs for every failed send.
      console.error('failed to send bulk mail to a recipient', {
        error: result.reason,
      });
    });
  }

  return {sent, failed};
}
