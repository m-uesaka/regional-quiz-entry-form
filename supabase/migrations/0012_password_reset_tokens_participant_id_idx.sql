-- Indexes `password_reset_tokens.participant_id`.
--
-- The table carried only its primary key and the `token_hash` unique index,
-- so the two statements that address a participant's links -- the
-- `where participant_id = ... and used_at is null` burn inside
-- `reset_participant_password`, and the pruning of expired rows in
-- `requestPasswordReset` -- both scanned the whole table.
--
-- That scan is not a constant cost: `POST
-- /api/auth/participant/password-reset/request` is unauthenticated and
-- unthrottled and inserts a row per call, so anyone looping it grows the
-- table without bound and slows down every reset in the system along with it.
-- The index does not stop the growth (see the pruning in
-- `lib/password-reset.ts`), it stops that growth from being felt by every
-- other participant.
create index password_reset_tokens_participant_id_idx
  on password_reset_tokens (participant_id);
