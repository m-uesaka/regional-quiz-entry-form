import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  StaffMailInputSchema,
  type StaffMailJob,
  type StaffMailResult,
} from '@regional-quiz/shared';
import type {Bindings, StaffEnv} from '../types/env';
import {requireStaffForTournament} from '../middleware/staff-auth';
import type {BulkMailMessage} from '../lib/bulk-mail-queue';
import {fetchTournamentRecipients} from '../lib/entry-recipients';
import {
  fetchResendableEntryIds,
  verificationMailSubject,
} from '../lib/entry-verification';
import {
  createMailJob,
  fetchMailJob,
  recordMailJobProgress,
} from '../lib/mail-jobs';
import {internalError} from '../lib/errors';
import {hasVisibleText, sanitizeMailHtml} from '../lib/mail-html';
import {
  fetchTournamentById,
  tournamentDisplayName,
  tournamentLookupFailure,
} from '../lib/tournaments';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});
const MailJobParamSchema = TournamentIdParamSchema.extend({
  jobId: z.string().uuid(),
});

/**
 * Recipients handed to the queue per `sendBatch()` call.
 *
 * Cloudflare's own cap: at most 100 messages, and 256 KB across them. The
 * messages here are a job id and one address or entry id, well inside the
 * size limit, so the count is what bounds a call.
 */
export const ENQUEUE_BATCH_SIZE = 100;

/**
 * Hands a job's messages to the bulk mail queue.
 *
 * There is no ceiling on how many. The send no longer runs on the ~30
 * seconds of post-response time the platform keeps a Worker alive for
 * after the response -- it runs in the queue's consumer, which is invoked
 * afresh per batch -- so the list that used to be refused with a 413 over
 * 80 addresses is simply enqueued (Task 10-4).
 * @param env The Worker bindings.
 * @param jobId The `mail_jobs` row the messages count against.
 * @param messages The messages to enqueue.
 * @returns The error that stopped the enqueueing, if any. By then the job's
 *     row already counts the messages that never got queued as failed.
 */
async function enqueueMailJob(
  env: Bindings,
  jobId: string,
  messages: readonly BulkMailMessage[],
): Promise<{ok: true} | {ok: false; error: unknown}> {
  for (let start = 0; start < messages.length; start += ENQUEUE_BATCH_SIZE) {
    const chunk = messages.slice(start, start + ENQUEUE_BATCH_SIZE);
    try {
      await env.BULK_MAIL_QUEUE.sendBatch(chunk.map(body => ({body})));
    } catch (error) {
      // Some earlier chunks may already be on their way, so the send
      // cannot be called off -- what is left is to make the job's row
      // tell the truth about the messages that never got queued. Without
      // this the job would sit at `sent + failed < total` forever and read
      // as one that is still running.
      const unqueued = messages.length - start;
      const recorded = await recordMailJobProgress(env, jobId, {
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
      return {ok: false, error};
    }
  }
  return {ok: true};
}

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

      // Narrowed to a few formatting tags before it is stored, so the
      // `mail_jobs` row holds exactly what goes out: one compromised staff
      // account must not be able to mail every participant arbitrary HTML
      // from the verified sending domain (#122).
      const bodyHtml = sanitizeMailHtml(body);
      if (!hasVisibleText(bodyHtml)) {
        return c.json({error: 'mail body is empty after sanitizing'}, 400);
      }

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
        bodyHtml,
        total: recipients.length,
      });
      if (!job.ok) {
        return c.json(
          internalError('failed to record the mail job', job.error),
          500,
        );
      }
      const jobId = job.value;

      const enqueued = await enqueueMailJob(
        c.env,
        jobId,
        recipients.map(to => ({jobId, to})),
      );
      if (!enqueued.ok) {
        // The job id goes out with the error rather than only with the
        // 202: this is exactly the case where the caller has to read the
        // job back before deciding whether to re-send, and there is no
        // other endpoint it could recover the id from.
        return c.json(
          {
            ...internalError('failed to enqueue the bulk mail', enqueued.error),
            jobId,
          },
          500,
        );
      }

      const response: StaffMailResult = {jobId, accepted: recipients.length};
      return c.json(response, 202);
    },
  )
  // The reminder for the unconfirmed entries, which a bulk send may not
  // reach (#192): their address may be a stranger's, so all they get is
  // the fixed confirmation mail they were sent on entering -- with a fresh
  // link -- never anything staff wrote. Entries whose link still works
  // already have that mail and are passed over (`fetchResendableEntryIds()`).
  // Runs through the bulk mail queue and answers like a bulk send, so the
  // job is watched through the same `GET .../mail/:jobId`.
  .post(
    '/tournaments/:tournamentId/verification-mail',
    zValidator('param', TournamentIdParamSchema),
    requireStaffForTournament(),
    async c => {
      const {tournamentId} = c.req.valid('param');

      let tournament;
      try {
        tournament = await fetchTournamentById(c.env, tournamentId);
      } catch (e) {
        return c.json(tournamentLookupFailure(e), 500);
      }
      if (!tournament) {
        return c.json({error: 'tournament not found'}, 404);
      }

      const entries = await fetchResendableEntryIds(c.env, tournamentId);
      if (!entries.ok) {
        return c.json(
          internalError(
            'failed to read the unconfirmed entries',
            entries.error,
          ),
          500,
        );
      }
      const entryIds = entries.value;

      // No body: each mail carries its own link, built by the consumer
      // when it issues the token. The subject is the one every mail of the
      // job goes out under, which is what the staff screen shows.
      const job = await createMailJob(c.env, {
        tournamentId,
        subject: verificationMailSubject(
          tournamentDisplayName(
            tournament.name,
            tournament.regions.name,
            tournament.type,
          ),
        ),
        bodyHtml: '',
        total: entryIds.length,
      });
      if (!job.ok) {
        return c.json(
          internalError('failed to record the mail job', job.error),
          500,
        );
      }
      const jobId = job.value;

      const enqueued = await enqueueMailJob(
        c.env,
        jobId,
        entryIds.map(entryId => ({jobId, entryId})),
      );
      if (!enqueued.ok) {
        return c.json(
          {
            ...internalError(
              'failed to enqueue the verification mail',
              enqueued.error,
            ),
            jobId,
          },
          500,
        );
      }

      const response: StaffMailResult = {jobId, accepted: entryIds.length};
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
