import {z} from 'zod';
import {EntryStatusSchema} from './entry';

// Bounds on what staff may compose. They exist to keep a single request
// from turning into an unbounded payload for the mail provider, not to
// enforce an editorial style, so they are deliberately generous.
export const STAFF_MAIL_SUBJECT_MAX_LENGTH = 200;
export const STAFF_MAIL_BODY_MAX_LENGTH = 20000;

// `POST /staff/tournaments/:tournamentId/mail` request body.
//
// `body` is sent as the mail's HTML content **as written**: it is neither
// escaped nor sanitized. Composing it requires a staff session for the
// tournament, and the same account can already read every participant's
// address, so staff-authored markup is trusted here on purpose. Anything
// pasted in from elsewhere has to be vetted by the staff member first.
//
// `statusFilter` narrows the recipients to the entries in one status.
// Omitting it mails every entry of the tournament **except the cancelled
// ones** -- someone who withdrew shouldn't keep receiving announcements,
// and mailing them takes a deliberate `statusFilter: 'cancelled'`.
export const StaffMailInputSchema = z.object({
  subject: z.string().min(1).max(STAFF_MAIL_SUBJECT_MAX_LENGTH),
  body: z.string().min(1).max(STAFF_MAIL_BODY_MAX_LENGTH),
  statusFilter: EntryStatusSchema.optional(),
});
export type StaffMailInput = z.infer<typeof StaffMailInputSchema>;

// `POST /staff/tournaments/:tournamentId/mail` response (202).
//
// `accepted` is how many distinct addresses the send was queued for, not
// how many messages arrived: the request returns as soon as the recipients
// are known, and the rate-controlled send runs on after it. Per-recipient
// delivery results therefore aren't in this response -- they belong to the
// mail provider's own delivery log.
export const StaffMailResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
});
export type StaffMailResult = z.infer<typeof StaffMailResultSchema>;
