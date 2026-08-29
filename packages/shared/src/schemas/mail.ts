import {z} from 'zod';
import {EntryStatusSchema} from './entry';

// Bounds on what staff may compose. They exist to keep a single request
// from turning into an unbounded payload for the mail provider, not to
// enforce an editorial style, so they are deliberately generous.
export const STAFF_MAIL_SUBJECT_MAX_LENGTH = 200;
export const STAFF_MAIL_BODY_MAX_LENGTH = 20000;

/**
 * `POST /staff/tournaments/:tournamentId/mail` request body.
 *
 * `body` is sent as the mail's HTML content **as written**: it is neither
 * escaped nor sanitized. Composing it requires a staff session for the
 * tournament, and the same account can already read every participant's
 * address, so staff-authored markup is trusted here on purpose. Anything
 * pasted in from elsewhere has to be vetted by the staff member first.
 *
 * `statusFilter` narrows the recipients to the entries in one status.
 * Omitting it mails every entry of the tournament **except the cancelled
 * ones** -- someone who withdrew shouldn't keep receiving announcements,
 * and mailing them takes a deliberate `statusFilter: 'cancelled'`.
 */
export const StaffMailInputSchema = z.object({
  subject: z.string().min(1).max(STAFF_MAIL_SUBJECT_MAX_LENGTH),
  body: z.string().min(1).max(STAFF_MAIL_BODY_MAX_LENGTH),
  statusFilter: EntryStatusSchema.optional(),
});
export type StaffMailInput = z.infer<typeof StaffMailInputSchema>;

/**
 * `POST /staff/tournaments/:tournamentId/mail` response (202).
 *
 * `accepted` is how many distinct addresses the send was queued for, not
 * how many messages arrived: the request returns as soon as the recipients
 * are known and have been handed to the queue, and the sending itself
 * happens in the queue's consumer afterwards.
 *
 * `jobId` is where the outcome shows up. It names the `mail_jobs` row the
 * consumer counts deliveries and failures into, readable through `GET
 * /staff/tournaments/:tournamentId/mail/:jobId` -- which is how the staff
 * screen answers "how many people did that reach?". Which *addresses*
 * bounced stays with the mail provider's own delivery log.
 */
export const StaffMailResultSchema = z.object({
  jobId: z.string().uuid(),
  accepted: z.number().int().nonnegative(),
});
export type StaffMailResult = z.infer<typeof StaffMailResultSchema>;

/**
 * `GET /staff/tournaments/:tournamentId/mail/:jobId` response.
 *
 * The progress of one bulk send. `sent + failed` climbs towards `total` as
 * the queue's consumer works through the recipients, so a job with
 * `sent + failed < total` is still going (or has recipients waiting on a
 * retry) and one where they are equal is finished. `updatedAt` moves every
 * time the consumer reports, which is what tells a slow send from a stuck
 * one.
 *
 * The body staff composed is left out: this is polled while a send runs,
 * and it may be 20 000 characters that the caller already has.
 */
export const StaffMailJobSchema = z.object({
  jobId: z.string().uuid(),
  subject: z.string(),
  total: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StaffMailJob = z.infer<typeof StaffMailJobSchema>;
