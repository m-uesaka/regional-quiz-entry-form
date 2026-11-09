/**
 * @fileoverview The mail of an anonymous entry submitted while its address
 * was over the per-address limit, sent later instead of refused (#346).
 *
 * The entry form limits submissions per address (`MAIL_TRIGGER_EMAIL_RATE_
 * LIMITER`) so a script can't bombard someone's inbox through it. Refusing
 * the submission over the limit (429) let the same script lock the owner of
 * the address out: three submissions a minute under their address, and the
 * owner's own entry was refused for as long as it kept going. So a
 * submission over the limit is entered like any other, and only its mail --
 * the verification link, or the notice of why it wasn't entered -- waits on
 * the bulk mail queue (`ENTRY_MAIL_DEFER_SECONDS`) and is sent when the
 * address is under a limit of its own (`DEFERRED_ENTRY_MAIL_KEY`).
 *
 * What keeps a flood of deferred mail from reaching the inbox anyway:
 *
 * - A verification mail is sent only if its entry still needs one when the
 *   message is handled (`prepareVerificationResend()`). An unverified
 *   address is taken over by every new submission, which deletes the
 *   account's entries (`take_over_unverified_participant()`), so of a flood
 *   only the latest submission's mail goes out -- whoever submitted last,
 *   as it already was for the mails sent at once.
 * - Every deferred mail counts against its own per-address key, under the
 *   same limit as the submissions, so a flood of notices (a verified address
 *   refusing wrong passwords) is paced, and dropped after the queue's last
 *   attempt rather than delivered for as long as it took to arrive.
 * - The deferred sends don't share the submissions' key: if they did, the
 *   submissions that keep the address over its limit would keep every
 *   deferred mail from going out, the owner's included.
 *
 * Like the staff reminders (`VerificationResendMessage`), a verification
 * message names the entry rather than carrying a link: the link's token is
 * issued here, just before the mail goes out, so no usable token sits in the
 * queue or its dead letter queue. Meanwhile the entry holds an expired
 * placeholder token (`holdForDeferredVerification()`), so that if the mail
 * never goes out, the owner's next submission lapses the entry
 * (`lapse_expired_pending_entries()`) and starts again, instead of being
 * told to look for a link that is not coming.
 */

import type {EntryNoticeReason} from './entry-notice';
import type {Bindings} from '../types/env';
import {buildEntryNoticeMail} from './entry-notice';
import {
  discardVerificationToken,
  prepareVerificationResend,
} from './entry-verification';
import {MailSendError, createMailSender, type SendMailInput} from './mailer';
import {MAIL_QUEUE_MAX_ATTEMPTS} from './bulk-mail-queue';
import {emailKey} from '../middleware/rate-limit';

/**
 * How long a deferred mail waits before its first attempt, and between
 * attempts that find its address still over the limit: the period of the
 * per-address limiter (`wrangler.toml`), after which it has room again.
 */
export const ENTRY_MAIL_DEFER_SECONDS = 60;

/** The verification mail of an entry written while over the limit. */
export interface DeferredVerificationMessage {
  kind: 'deferred-verification';
  entryId: string;
  /** Where it goes, for the limiter; the mail itself reads it again. */
  to: string;
  /** As for `sendVerificationEmail()`; absent when none were withdrawn. */
  withdrawnTournaments?: string[];
}

/** The notice of a submission over the limit that wasn't entered. */
export interface DeferredNoticeMessage {
  kind: 'deferred-notice';
  to: string;
  tournamentName: string;
  reason: EntryNoticeReason;
}

/** A mail of an entry submission, deferred for its address's limit. */
export type DeferredEntryMailMessage =
  DeferredVerificationMessage | DeferredNoticeMessage;

/**
 * Whether a bulk mail queue message is a deferred entry mail rather than a
 * recipient of a staff send or reminder.
 * @param message The queue message's body.
 */
export function isDeferredEntryMail(
  message: object,
): message is DeferredEntryMailMessage {
  return (
    'kind' in message &&
    (message.kind === 'deferred-verification' ||
      message.kind === 'deferred-notice')
  );
}

/**
 * Puts a deferred entry mail on the queue, to be handled after
 * `ENTRY_MAIL_DEFER_SECONDS`.
 * @param env The Worker bindings.
 * @param message The mail to defer.
 */
export async function deferEntryMail(
  env: Bindings,
  message: DeferredEntryMailMessage,
): Promise<void> {
  await env.BULK_MAIL_QUEUE.send(message, {
    delaySeconds: ENTRY_MAIL_DEFER_SECONDS,
  });
}

/**
 * Whether `to` may be sent a deferred entry mail now. Counts the attempt:
 * the binding has no way to look without spending.
 * @param env The Worker bindings.
 * @param to The address.
 */
async function deferredMailAllowed(
  env: Bindings,
  to: string,
): Promise<boolean> {
  const {success} = await env.MAIL_TRIGGER_EMAIL_RATE_LIMITER.limit({
    key: emailKey('entry-deferred-mail', to),
  });
  return success;
}

/**
 * Sends the deferred entry mails of one queue batch, settling each message
 * on its own: sent, no longer needed and permanently refused ones are
 * acked; one whose address is still over its limit, or whose send failed
 * only for now, is sent back for a later attempt, and given up on (logged)
 * on the last one.
 * @param messages The batch's deferred entry mails.
 * @param env The Worker bindings.
 */
export async function handleDeferredEntryMail(
  messages: ReadonlyArray<Message<DeferredEntryMailMessage>>,
  env: Bindings,
): Promise<void> {
  const mailer = createMailSender(env);
  for (const message of messages) {
    await handleOne(message, env, mailer);
  }
}

async function handleOne(
  message: Message<DeferredEntryMailMessage>,
  env: Bindings,
  mailer: ReturnType<typeof createMailSender>,
): Promise<void> {
  const body = message.body;
  const later = (why: string) => {
    if (message.attempts < MAIL_QUEUE_MAX_ATTEMPTS) {
      message.retry({delaySeconds: ENTRY_MAIL_DEFER_SECONDS});
      return;
    }
    // A verification mail given up on leaves its entry to lapse on the
    // owner's next submission (see the file overview).
    console.error('gave up on a deferred entry mail', {kind: body.kind, why});
    message.ack();
  };

  let mail: SendMailInput;
  let tokenId: string | undefined;
  if (body.kind === 'deferred-verification') {
    // Read first, and before the limiter is spent: most of a flood is
    // entries a later submission has already replaced.
    const prepared = await prepareVerificationResend(
      env,
      body.entryId,
      body.withdrawnTournaments,
    );
    if (!prepared.ok) {
      console.error('failed to prepare a deferred verification mail', {
        entryId: body.entryId,
        error: prepared.error,
      });
      later('prepare');
      return;
    }
    if (prepared.value === null) {
      // Replaced, confirmed, cancelled or given a link since: nothing to do.
      message.ack();
      return;
    }
    ({mail, tokenId} = prepared.value);
  } else {
    mail = buildEntryNoticeMail(env, body.to, body.tournamentName, body.reason);
  }

  const discardToken = async () => {
    if (tokenId === undefined) return;
    const discarded = await discardVerificationToken(env, tokenId);
    if (!discarded.ok) {
      console.error('failed to discard an undelivered verification token', {
        error: discarded.error,
      });
    }
  };

  if (!(await deferredMailAllowed(env, body.to))) {
    await discardToken();
    later('rate limited');
    return;
  }

  try {
    await mailer.send({
      ...mail,
      // Keyed by what is sent, as the reminders are: a verification mail by
      // its link, a notice by the queue message, which is the same on every
      // delivery.
      idempotencyKey:
        tokenId === undefined
          ? `entry-notice-deferred/${message.id}`
          : `entry-verification-deferred/${tokenId}`,
    });
  } catch (error) {
    await discardToken();
    if (error instanceof MailSendError && error.isTransient()) {
      later('transient send failure');
      return;
    }
    console.error('failed to send a deferred entry mail', {
      kind: body.kind,
      error,
    });
    message.ack();
    return;
  }
  message.ack();
}
