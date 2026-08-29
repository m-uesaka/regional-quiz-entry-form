import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  StaffMailInputSchema,
  type StaffMailJob,
  type StaffMailResult,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireStaffForTournament} from '../middleware/staff-auth';
import type {BulkMailMessage} from '../lib/bulk-mail-queue';
import {fetchTournamentRecipients} from '../lib/entry-recipients';
import {
  createMailJob,
  fetchMailJob,
  recordMailJobProgress,
} from '../lib/mail-jobs';
import {internalError} from '../lib/errors';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});
const MailJobParamSchema = TournamentIdParamSchema.extend({
  jobId: z.string().uuid(),
});

/**
 * Recipients handed to the queue per `sendBatch()` call.
 *
 * Cloudflare's own cap: at most 100 messages, and 256 KB across them. The
 * messages here are a job id and one address, well inside the size limit,
 * so the count is what bounds a call.
 */
export const ENQUEUE_BATCH_SIZE = 100;

export const staffMailRoute = new Hono<StaffEnv>()
  .post(
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

      // Written before anything is enqueued: this row is where the content
      // lives (the messages carry only an address, see `BulkMailMessage`),
      // so a consumer that picks a message up the moment it lands has to
      // find it already there. It doubles as the record of the send that
      // the staff screen reads back.
      const job = await createMailJob(c.env, {
        tournamentId,
        subject,
        bodyHtml: body,
        total: recipients.length,
      });
      if (!job.ok) {
        return c.json(
          internalError('failed to record the mail job', job.error),
          500,
        );
      }
      const jobId = job.value;

      // There is no ceiling on `recipients.length` any more. The send no
      // longer runs on the ~30 seconds of post-response time the platform
      // keeps a Worker alive for after the response -- it runs in the
      // queue's consumer, which is invoked afresh per batch -- so the list
      // that used to be refused with a 413 over 80 addresses is simply
      // enqueued (Task 10-4).
      for (
        let start = 0;
        start < recipients.length;
        start += ENQUEUE_BATCH_SIZE
      ) {
        const chunk = recipients.slice(start, start + ENQUEUE_BATCH_SIZE);
        try {
          await c.env.BULK_MAIL_QUEUE.sendBatch(
            chunk.map(to => ({body: {jobId, to} satisfies BulkMailMessage})),
          );
        } catch (error) {
          // Some earlier chunks may already be on their way, so the send
          // cannot be called off -- what is left is to make the job's row
          // tell the truth about the addresses that never got queued.
          // Without this the job would sit at `sent + failed < total`
          // forever and read as one that is still running.
          const unqueued = recipients.length - start;
          const recorded = await recordMailJobProgress(c.env, jobId, {
            sent: 0,
            failed: unqueued,
          });
          if (!recorded.ok) {
            console.error('failed to record unqueued bulk mail recipients', {
              jobId,
              unqueued,
              error: recorded.error,
            });
          }
          return c.json(
            internalError('failed to enqueue the bulk mail', error),
            500,
          );
        }
      }

      const response: StaffMailResult = {jobId, accepted: recipients.length};
      return c.json(response, 202);
    },
  )
  // How many of a send actually went out. The consumer counts every
  // recipient it settles into the job's row, so this is the answer to "did
  // that reach everyone?" that used to exist only as a line in the
  // Worker's log.
  .get(
    '/tournaments/:tournamentId/mail/:jobId',
    zValidator('param', MailJobParamSchema),
    requireStaffForTournament(),
    async c => {
      const {tournamentId, jobId} = c.req.valid('param');

      // Scoped by tournament as well as by id, so a job of a tournament
      // this staff member may not see is a 404 rather than a readable row:
      // the middleware above only vouches for the tournament in the path.
      const result = await fetchMailJob(c.env, tournamentId, jobId);
      if (!result.ok) {
        return c.json(
          internalError('failed to read the mail job', result.error),
          500,
        );
      }
      if (result.value === null) {
        return c.json({error: 'mail job not found'}, 404);
      }

      const response: StaffMailJob = {
        jobId: result.value.id,
        subject: result.value.subject,
        total: result.value.total,
        sent: result.value.sent,
        failed: result.value.failed,
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      };
      return c.json(response);
    },
  );
