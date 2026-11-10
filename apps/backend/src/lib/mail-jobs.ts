import type {StaffMailJob} from '@regional-quiz/shared';
import {type DbClient, type Tables} from './db';
import type {InternalResult} from './errors';

/** The content half of a job, which is all the queue consumer reads. */
export interface MailJobContent {
  id: string;
  subject: string;
  bodyHtml: string;
}

/** Shape of a `mail_jobs` row (snake_case), minus the body. */
type MailJobRow = Pick<
  Tables<'mail_jobs'>,
  'id' | 'subject' | 'total' | 'sent' | 'failed' | 'created_at' | 'updated_at'
>;

/** Turns a row into what the staff status endpoint answers with. */
function rowToStaffMailJob(row: MailJobRow): StaffMailJob {
  return {
    jobId: row.id,
    subject: row.subject,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Records a bulk send that is about to be enqueued, and returns its id.
 *
 * The row is written before the first message is enqueued, for two
 * reasons. The consumer reads the subject and body back out of it -- they
 * are not in the messages, which a Cloudflare queue caps at 128 KB each
 * and 256 KB per `sendBatch()` call, far too little to carry a 20 000
 * character body per recipient. And a job whose row exists but whose
 * messages were never enqueued reads as "nothing sent", which is the
 * truth; the other order would have a consumer meet a job id with no row
 * behind it.
 * @param db The database client.
 * @param job The tournament, content, and recipient count of the send.
 */
export async function createMailJob(
  db: DbClient,
  job: {
    tournamentId: string;
    subject: string;
    bodyHtml: string;
    total: number;
  },
): Promise<InternalResult<string>> {
  const {data, error} = await db
    .from('mail_jobs')
    .insert({
      tournament_id: job.tournamentId,
      subject: job.subject,
      body_html: job.bodyHtml,
      total: job.total,
    })
    .select('id')
    .single();
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  return {ok: true, value: data.id};
}

/**
 * Reads back what to send for a job, or `null` when no such job exists.
 *
 * Only the content is selected: the counters move while the consumer
 * works, and reading them here would invite deciding something from a
 * value that is stale by the time it is used.
 * @param db The database client.
 * @param jobId The job the queue message names.
 */
export async function fetchMailJobContent(
  db: DbClient,
  jobId: string,
): Promise<InternalResult<MailJobContent | null>> {
  const {data, error} = await db
    .from('mail_jobs')
    .select('id, subject, body_html')
    .eq('id', jobId)
    .maybeSingle();
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!data) {
    return {ok: true, value: null};
  }
  return {
    ok: true,
    value: {id: data.id, subject: data.subject, bodyHtml: data.body_html},
  };
}

/**
 * Reads one job of one tournament, or `null` when there is no such job.
 *
 * The body is left out of the select on purpose: this backs the endpoint
 * the staff screen polls while a send runs, and pulling 20 000 characters
 * out of Postgres several times a second to then drop them is waste on the
 * one path that repeats. The consumer reads it as `MailJobContent` instead. The
 * tournament is part of the lookup rather than checked afterwards:
 * this is what the staff endpoint scopes on, so a job id belonging to
 * another region's tournament has to come back as "not found" rather than
 * as a row the caller then has to remember to compare.
 * @param db The database client.
 * @param tournamentId The tournament the caller is authorized for.
 * @param jobId The job to read.
 */
export async function fetchMailJob(
  db: DbClient,
  tournamentId: string,
  jobId: string,
): Promise<InternalResult<StaffMailJob | null>> {
  const {data, error} = await db
    .from('mail_jobs')
    .select('id, subject, total, sent, failed, created_at, updated_at')
    .eq('id', jobId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  return {ok: true, value: data ? rowToStaffMailJob(data) : null};
}

/**
 * Adds one consumer batch's outcome to a job's counters.
 *
 * Goes through `record_mail_job_progress()` rather than reading the
 * counters and writing them back: consumer invocations run concurrently,
 * and two batches that both read the same `sent` would both write the same
 * value, losing one batch's worth of deliveries. The function increments
 * inside the database instead.
 * @param db The database client.
 * @param jobId The job the batch belonged to.
 * @param progress How many of the batch's messages were delivered and how
 *     many were given up on. Messages sent back for another delivery
 *     belong to neither, and are counted when they finally settle.
 */
export async function recordMailJobProgress(
  db: DbClient,
  jobId: string,
  progress: {sent: number; failed: number},
): Promise<InternalResult<void>> {
  const {error} = await db.rpc('record_mail_job_progress', {
    p_job_id: jobId,
    p_sent: progress.sent,
    p_failed: progress.failed,
  });
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  return {ok: true, value: undefined};
}
