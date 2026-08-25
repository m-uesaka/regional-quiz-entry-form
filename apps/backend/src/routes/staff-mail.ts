import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  StaffMailInputSchema,
  type StaffMailResult,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireStaffForTournament} from '../middleware/staff-auth';
import {ResendMailSender} from '../lib/mailer';
import {sendBulkMail} from '../lib/bulk-mail';
import {fetchTournamentRecipients} from '../lib/entry-recipients';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

export const staffMailRoute = new Hono<StaffEnv>().post(
  '/tournaments/:tournamentId/mail',
  zValidator('param', TournamentIdParamSchema),
  // The scope check runs before the body is validated, so an unauthorized
  // caller gets the same 401/403 whatever they put in the request body.
  requireStaffForTournament(),
  zValidator('json', StaffMailInputSchema),
  async c => {
    const {tournamentId} = c.req.valid('param');
    const {subject, body, statusFilter} = c.req.valid('json');

    const result = await fetchTournamentRecipients(
      c.env,
      tournamentId,
      statusFilter,
    );
    if (!result.ok) {
      return c.json({error: result.error}, 500);
    }
    const {recipients} = result;

    const mailer = new ResendMailSender(
      c.env.MAIL_API_KEY,
      c.env.MAIL_FROM_ADDRESS,
    );
    // Handed to `waitUntil()` rather than awaited: `sendBulkMail()` paces
    // itself against the mail provider's rate limit, so a tournament of a
    // few hundred entries takes minutes -- far longer than the client will
    // hold the connection open, and a disconnect would cancel the send
    // half-finished with nothing reported. Answering with the recipient
    // count and sending on afterwards keeps the whole list mailed.
    c.executionCtx.waitUntil(
      sendBulkMail(mailer, recipients, {subject, html: body}).then(
        sendResult => {
          if (sendResult.failed.length > 0) {
            console.error(
              'some recipients of a staff bulk mail were rejected',
              {
                tournamentId,
                accepted: recipients.length,
                sent: sendResult.sent,
                failedCount: sendResult.failed.length,
              },
            );
          }
        },
      ),
    );

    const response: StaffMailResult = {accepted: recipients.length};
    return c.json(response, 202);
  },
);
