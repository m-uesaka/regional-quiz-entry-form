-- Supports the public entry-list endpoint (`GET /:tournamentId/entry-list`),
-- which filters `entries` by `tournament_id` and orders by `created_at`.
-- The existing unique index on `entries` is `(participant_id, tournament_id)`,
-- which doesn't help here since `tournament_id` isn't its leading column, so
-- every request would otherwise scan the full table and sort the matches.
--
-- Partial on the exact statuses that endpoint selects
-- (`confirmed`, `waitlisted`, `cancelled` — i.e. everything except
-- `pending_verification`), so the index stays small and doesn't need to be
-- maintained for rows the endpoint never reads.
create index entries_tournament_id_created_at_idx
  on entries (tournament_id, created_at)
  where status in ('confirmed', 'waitlisted', 'cancelled');
