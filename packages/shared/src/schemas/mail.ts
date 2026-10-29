import {z} from 'zod';
import {EntryStatusSchema} from './entry';

// Bounds on what staff may compose. They exist to keep a single request
// from turning into an unbounded payload for the mail provider, not to
// enforce an editorial style, so they are deliberately generous.
export const STAFF_MAIL_SUBJECT_MAX_LENGTH = 200;
export const STAFF_MAIL_BODY_MAX_LENGTH = 20000;

/**
 * The entry statuses a staff bulk send may be narrowed to: every status but
 * `pending_verification` (see `StaffMailInputSchema`).
 */
export const StaffMailStatusFilterSchema = EntryStatusSchema.exclude([
  'pending_verification',
]);
export type StaffMailStatusFilter = z.infer<typeof StaffMailStatusFilterSchema>;

/**
 * `POST /staff/tournaments/:tournamentId/mail` request body.
 *
 * `body` is the mail's HTML content, narrowed by the API to a few formatting
 * tags before it is stored and sent (`sanitizeMailHtml()` in
 * `apps/backend/src/lib/mail-html.ts`): `p`, `br`, `strong`, `em`, `ul`,
 * `ol`, `li`, and `a` with an `http:` / `https:` / `mailto:` `href`. Every
 * other tag and attribute is removed, and `script` / `style` and the like
 * lose their content too. It goes out from the organization's verified
 * sending domain to every participant of the tournament, so a single
 * compromised staff account must not be able to send them arbitrary HTML
 * (#122). A body left empty by that is refused with 400.
 *
 * `statusFilter` narrows the recipients to the entries in one status.
 * Omitting it mails the **`confirmed` and `waitlisted`** entries only
 * (`DEFAULT_RECIPIENT_STATUSES` in `apps/backend/src/lib/entry-recipients.ts`);
 * mailing the cancelled ones takes a deliberate `statusFilter: 'cancelled'`,
 * since someone who withdrew shouldn't keep receiving announcements.
 *
 * `pending_verification` is refused outright (400), not merely left out of
 * the default (#192): anyone can enter under a stranger's address and leave
 * the entry unconfirmed, so a staff-written body sent to those entries
 * would reach someone who never agreed to it, from the organization's
 * sending domain. The unconfirmed are reminded with the fixed confirmation
 * mail instead (`POST /staff/tournaments/:tournamentId/verification-mail`).
 * Whatever the filter, only participants who have confirmed their address
 * are mailed.
 */
export const StaffMailInputSchema = z.object({
  subject: z.string().min(1).max(STAFF_MAIL_SUBJECT_MAX_LENGTH),
  body: z.string().min(1).max(STAFF_MAIL_BODY_MAX_LENGTH),
  statusFilter: StaffMailStatusFilterSchema.optional(),
});
export type StaffMailInput = z.infer<typeof StaffMailInputSchema>;

/**
 * `POST /staff/tournaments/:tournamentId/mail` and
 * `POST /staff/tournaments/:tournamentId/verification-mail` response (202).
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
