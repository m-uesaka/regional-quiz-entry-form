-- The staff bulk send (`POST /api/staff/tournaments/:id/mail`) becomes a
-- Cloudflare Queue producer in Task 10-4: the request only works out the
-- recipient list and enqueues it, and a consumer does the sending
-- afterwards. This table is what makes that send observable.
--
-- It holds two things at once:
--
--   * The *content* of the send. The queue message carries only the job id
--     and one address, because Cloudflare caps a message at 128 KB and a
--     `sendBatch()` call at 256 KB, while `STAFF_MAIL_BODY_MAX_LENGTH`
--     alone allows 20 000 characters -- copying the body into every
--     message would put a few dozen recipients over the batch limit. The
--     body is stored once here and read back by the consumer instead.
--   * The *progress* of the send. Until now the only record of a bulk send
--     was `console.error` in the Worker's log, so "how many people did that
--     actually reach?" had no answer the staff screen could show.
create table mail_jobs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id),
  subject text not null,
  body_html text not null,
  -- How many addresses were enqueued. `sent + failed` climbs towards this
  -- as the consumer works through them, and a job with
  -- `sent + failed < total` is still in flight (or has messages waiting on
  -- a retry).
  total integer not null,
  sent integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- So the staff screen can tell a job that is still working from one that
-- stalled: `updated_at` moves every time a consumer batch reports in.
-- `set_updated_at()` is `0001`'s.
create trigger mail_jobs_set_updated_at
  before update on mail_jobs
  for each row
  execute function set_updated_at();

-- The one query the staff screen makes is "this tournament's sends, newest
-- first", and a bulk send leaves a row behind every time -- this is a table
-- that only grows.
create index mail_jobs_tournament_id_created_at_idx
  on mail_jobs (tournament_id, created_at desc);

-- `0001`'s blanket RLS and grants covered `all tables in schema public` as
-- it stood then, which does not include this one. Without the revoke, the
-- Data API roles would keep the default grants -- and a mail job row holds
-- the body staff wrote, readable by `anon` at that point.
alter table mail_jobs enable row level security;
revoke all on mail_jobs from anon, authenticated;
grant select, insert, update, delete on mail_jobs to service_role;

-- Adds one batch's outcome to a job's counters.
--
-- This exists instead of a read-modify-write from the Worker because the
-- queue's consumer invocations run concurrently: two batches of the same
-- job that both read `sent = 40` would both write `sent = 45`, and five
-- delivered messages would vanish from the count. `update ... set sent =
-- sent + n` is resolved by Postgres under the row lock the update itself
-- takes, so the increments cannot be lost however many consumers report at
-- once.
--
-- An unknown `p_job_id` updates no row and is not an error: the job's row
-- can only be gone if someone deleted it, and failing the batch over that
-- would have the consumer retry -- and so re-send -- messages that were
-- delivered.
create or replace function record_mail_job_progress(
  p_job_id uuid,
  p_sent integer,
  p_failed integer
)
returns void
language sql
volatile
as $$
  update mail_jobs
    set sent = sent + p_sent,
        failed = failed + p_failed
    where id = p_job_id;
$$;

revoke all on function record_mail_job_progress(uuid, integer, integer)
  from public;
grant execute on function record_mail_job_progress(uuid, integer, integer)
  to service_role;
