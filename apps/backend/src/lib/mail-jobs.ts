import type {Bindings} from '../types/env';
import {createDbClient} from './db';

/** What a staff bulk send is recorded as while it runs and after it ends. */
export interface MailJob {
  id: string;
  tournamentId: string;
  subject: string;
  bodyHtml: string;
  /** Addresses enqueued when the send was accepted. */
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
}

/** The content half of a job, which is all the queue consumer reads. */
export type MailJobContent = Pick<MailJob, 'id' | 'subject' | 'bodyHtml'>;

/** Shape of a `mail_jobs` row (snake_case). */
interface MailJobRow {
  id: string;
  tournament_id: string;
  subject: string;
  body_html: string;
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  updated_at: string;
}

type Result<T> = {ok: true; value: T} | {ok: false; error: string};

function rowToMailJob(row: MailJobRow): MailJob {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    subject: row.subject,
    bodyHtml: row.body_html,
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
 * @param env The Worker bindings.
 * @param job The tournament, content, and recipient count of the send.
 */
export async function createMailJob(
  env: Bindings,
  job: {
    tournamentId: string;
    subject: string;
    bodyHtml: string;
    total: number;
  },
): Promise<Result<string>> {
  const db = createDbClient(env);
  const {data, error} = await db
    .from('mail_jobs')
    .insert({
      tournament_id: job.tournamentId,
      subject: job.subject,
      body_html: job.bodyHtml,
      total: job.total,
    })
    .select('id')
    .single<{id: string}>();
  if (error) {
    return {ok: false, error: error.message};
  }
  return {ok: true, value: data.id};
}

/**
 * Reads back what to send for a job, or `null` when no such job exists.
 *
 * Only the content is selected: the counters move while the consumer
 * works, and reading them here would invite deciding something from a
 * value that is stale by the time it is used.
 * @param env The Worker bindings.
 * @param jobId The job the queue message names.
 */
export async function fetchMailJobContent(
  env: Bindings,
  jobId: string,
): Promise<Result<MailJobContent | null>> {
  const db = createDbClient(env);
  const {data, error} = await db
    .from('mail_jobs')
    .select('id, subject, body_html')
    .eq('id', jobId)
    .maybeSingle<Pick<MailJobRow, 'id' | 'subject' | 'body_html'>>();
  if (error) {
    return {ok: false, error: error.message};
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
 * The tournament is part of the lookup rather than checked afterwards:
 * this is what the staff endpoint scopes on, so a job id belonging to
 * another region's tournament has to come back as "not found" rather than
 * as a row the caller then has to remember to compare.
 * @param env The Worker bindings.
 * @param tournamentId The tournament the caller is authorized for.
 * @param jobId The job to read.
 */
export async function fetchMailJob(
  env: Bindings,
  tournamentId: string,
  jobId: string,
): Promise<Result<MailJob | null>> {
  const db = createDbClient(env);
  const {data, error} = await db
    .from('mail_jobs')
    .select(
      'id, tournament_id, subject, body_html, total, sent, failed, created_at, updated_at',
    )
    .eq('id', jobId)
    .eq('tournament_id', tournamentId)
    .maybeSingle<MailJobRow>();
  if (error) {
    return {ok: false, error: error.message};
  }
  return {ok: true, value: data ? rowToMailJob(data) : null};
}

/**
 * Adds one consumer batch's outcome to a job's counters.
 *
 * Goes through `record_mail_job_progress()` rather than reading the
 * counters and writing them back: consumer invocations run concurrently,
 * and two batches that both read the same `sent` would both write the same
 * value, losing one batch's worth of deliveries. The function increments
 * inside the database instead.
 * @param env The Worker bindings.
 * @param jobId The job the batch belonged to.
 * @param progress How many of the batch's messages were delivered and how
 *     many were given up on. Messages sent back for another delivery
 *     belong to neither, and are counted when they finally settle.
 */
export async function recordMailJobProgress(
  env: Bindings,
  jobId: string,
  progress: {sent: number; failed: number},
): Promise<Result<void>> {
  const db = createDbClient(env);
  const {error} = await db.rpc('record_mail_job_progress', {
    p_job_id: jobId,
    p_sent: progress.sent,
    p_failed: progress.failed,
  });
  if (error) {
    return {ok: false, error: error.message};
  }
  return {ok: true, value: undefined};
}
