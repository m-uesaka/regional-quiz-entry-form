import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  StaffMailInputSchema,
  type StaffMailResult,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireStaffForTournament} from '../middleware/staff-auth';
import {createMailSender} from '../lib/mailer';
import {MAX_BACKGROUND_RECIPIENTS, sendBulkMail} from '../lib/bulk-mail';
import {fetchTournamentRecipients} from '../lib/entry-recipients';
import {internalError} from '../lib/errors';

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
      return c.json(
        internalError('failed to read the mail recipients', result.error),
        500,
      );
    }
    const {recipients} = result;

    // TODO: move the paced send onto a durable Cloudflare Queue (or
    // Workflow) consumer, which may run for minutes, and drop this ceiling
    // once the send no longer depends on the request's `waitUntil()`
    // budget.
    //
    // Until then a list this long cannot be finished in the background, so
    // it is refused rather than accepted with a 202 whose tail would be
    // cancelled without anybody being told.
    if (recipients.length > MAX_BACKGROUND_RECIPIENTS) {
      return c.json(
        {
          error:
            `too many recipients: ${recipients.length} matched, but one ` +
            `request can send to at most ${MAX_BACKGROUND_RECIPIENTS}. ` +
            'Narrow the send with statusFilter and repeat it per status.',
        },
        413,
      );
    }

    const mailer = createMailSender(c.env);
    // Handed to `waitUntil()` rather than awaited: `sendBulkMail()` paces
    // itself against the mail provider's rate limit, so even a list at the
    // ceiling above spends most of a minute waiting between batches --
    // longer than a client will reliably hold the connection open, and a
    // disconnect would cancel the send half-finished with nothing
    // reported. Answering with the recipient count and sending on
    // afterwards keeps the whole list mailed.
    c.executionCtx.waitUntil(
      sendBulkMail(mailer, recipients, {subject, html: body})
        .then(sendResult => {
          if (sendResult.failed.length > 0) {
            // Covers both the addresses the provider rejected and any the
            // run had no budget left to reach; which is which is in
            // `sendBulkMail()`'s own logs.
            console.error(
              'some recipients of a staff bulk mail were not delivered to',
              {
                tournamentId,
                accepted: recipients.length,
                sent: sendResult.sent,
                undeliveredCount: sendResult.failed.length,
              },
            );
          }
        })
        // `sendBulkMail()` settles each recipient itself, so a rejection
        // here means the run as a whole broke. Swallowing it keeps an
        // unhandled rejection from taking down the Worker after the
        // response has already gone out.
        .catch((error: unknown) => {
          console.error('staff bulk mail run failed', {tournamentId, error});
        }),
    );

    const response: StaffMailResult = {accepted: recipients.length};
    return c.json(response, 202);
  },
);
