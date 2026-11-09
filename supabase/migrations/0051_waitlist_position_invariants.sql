-- キャンセル待ちの順位(`entries.waitlist_position`)の不変条件を DB で保証する
-- (#286)。
--
-- これまで新しいキャンセル待ちの順位は「キャンセル待ちの件数 + 1」
-- (`confirm_entry_by_token()`、0047)で、順位が 1 から欠番なく並んでいることが
-- 前提だった。その維持は 2 か所の手書きの詰め直し(`cancel_own_entry()` の
-- 0006、`promote_waitlisted_entries()` の 0037)に頼っており、
-- 「`waitlisted` のときだけ順位が入る」ことも、大会の中で順位が一意であることも
-- 制約になっていなかった。別の経路で `waitlisted` の行を消したり変えたりして
-- 欠番ができると、件数 + 1 が既存の順位と重なり、同じ順位の行は id 順に
-- 繰り上がるので後から来た人が追い越す。しかも気付けない。
--
-- 1. 採番を「キャンセル待ちの最大の順位 + 1」にする。欠番があっても重ならない。
--    件数は「キャンセル待ちがいるか」の判定(0047)にだけ使う。最大値も件数と
--    同じく大会の行のロックを取った後に読むので、採番と競合する変更はない
--    (0047 の冒頭のコメントを参照)。
-- 2. `check ((status = 'waitlisted') = (waitlist_position is not null))` と
--    `check (waitlist_position > 0)` を足す。順位を外し忘れた取り消しや、
--    順位のないキャンセル待ちは断られる。
-- 3. `unique (tournament_id, waitlist_position)` を `deferrable initially
--    deferred` で足す。詰め直しの UPDATE(順位を 1 ずつ下げる、1 から振り
--    直す)は途中で一時的に同じ順位を作りうる。Postgres の一意制約は即時だと
--    行ごとに検査されるので、コミット時の検査にする。NULL は一意性の対象外
--    なので、`waitlisted` 以外の行は何件あってもよい。
--
-- 既存の行は、制約を足す前に直す。
--   - `waitlisted` 以外の行の順位は消す(どの関数も外しているはずだが、手で
--     直した行がありうる)
--   - `waitlisted` の行は、大会ごとに今の順(順位の小さい順、同じ順位や順位の
--     ない行は作成順・id 順)で 1 から振り直す。`promote_waitlisted_entries()`
--     が繰り上げる順(順位、id)と、順位のある行同士では変わらない
-- 振り直しは大会の行をロックせずに行う。マイグレーションの間に確認・取り消し・
-- 繰り上げが走っても、一意制約は同じトランザクションのコミット時に検査される
-- ので、重なればこのマイグレーションか相手のどちらかが失敗する(黙って重なる
-- ことはない)。
--
-- `confirm_entry_by_token()` のシグネチャと返り値は変えないので、デプロイ中の
-- 古い Worker からもそのまま呼べる。

update entries
  set waitlist_position = null
  where status <> 'waitlisted' and waitlist_position is not null;

update entries e
  set waitlist_position = renumbered.n
  from (
    select w.id, row_number() over (
        partition by w.tournament_id
        order by w.waitlist_position asc nulls last, w.created_at asc, w.id asc
      )::integer as n
      from entries w
      where w.status = 'waitlisted'
  ) renumbered
  where e.id = renumbered.id
    and e.waitlist_position is distinct from renumbered.n;

alter table entries
  add constraint entries_waitlist_position_iff_waitlisted
    check ((status = 'waitlisted') = (waitlist_position is not null)),
  add constraint entries_waitlist_position_positive
    check (waitlist_position > 0),
  add constraint entries_tournament_id_waitlist_position_key
    unique (tournament_id, waitlist_position)
    deferrable initially deferred;

create or replace function confirm_entry_by_token(p_token_hash text)
returns entry_status
language plpgsql
as $$
declare
  v_participant_id uuid;
  v_token_id uuid;
  v_entry_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
  v_tournament_id uuid;
  v_entry_status entry_status;
  v_capacity integer;
  v_confirmed_count bigint;
  v_waitlisted_count bigint;
  v_last_waitlist_position integer;
  v_status entry_status;
  v_waitlist_position integer;
begin
  -- Unlocked, only to learn which participant row to lock first. Nothing is
  -- decided on it: the token is read again under its own lock below.
  select e.participant_id into v_participant_id
    from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where evt.token_hash = p_token_hash;

  if v_participant_id is null then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  perform 1 from participants p
    where p.id = v_participant_id
    for no key update;

  -- The token may have been burnt, or its entry deleted by
  -- `take_over_unverified_participant()`, while the participant lock was
  -- being waited for; both read as an unknown or used token here.
  select evt.id, evt.entry_id, evt.expires_at, evt.used_at, e.tournament_id
    into v_token_id, v_entry_id, v_expires_at, v_used_at, v_tournament_id
    from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where evt.token_hash = p_token_hash
    for update of evt;

  if v_token_id is null or v_used_at is not null or v_expires_at < now() then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  select capacity into v_capacity
    from tournaments where id = v_tournament_id for update;

  -- Re-read under the lock: a concurrent cancellation may have moved the
  -- entry since the token lookup above.
  select e.status into v_entry_status from entries e where e.id = v_entry_id;

  if v_entry_status <> 'pending_verification' then
    raise exception 'entry is not awaiting verification'
      using errcode = 'P0003';
  end if;

  select count(*) filter (where status = 'confirmed'),
         count(*) filter (where status = 'waitlisted'),
         max(waitlist_position) filter (where status = 'waitlisted')
    into v_confirmed_count, v_waitlisted_count, v_last_waitlist_position
    from entries
    where tournament_id = v_tournament_id;

  -- Anyone already waiting goes first: a seat freed by a cancellation or a
  -- raised capacity belongs to the head of the queue, which
  -- `promote_waitlisted_entries()` fills in order. So a non-empty queue
  -- sends this entry to its tail even when a seat is free right now; the
  -- caller then runs that promotion, which may well reach this entry.
  if v_waitlisted_count > 0
      or (v_capacity is not null and v_confirmed_count >= v_capacity) then
    v_status := 'waitlisted';
    -- Behind the last one rather than at count + 1: a gap left in the
    -- queue would otherwise hand out a position already taken (#286).
    v_waitlist_position := coalesce(v_last_waitlist_position, 0) + 1;
  else
    v_status := 'confirmed';
    v_waitlist_position := null;
  end if;

  update entries
    set status = v_status,
        email_verified_at = now(),
        waitlist_position = v_waitlist_position
    where id = v_entry_id;

  update email_verification_tokens
    set used_at = now()
    where id = v_token_id;

  -- The first confirmation is what proves the address; later ones leave the
  -- original time alone.
  update participants
    set email_verified_at = now()
    where id = v_participant_id and email_verified_at is null;

  return v_status;
end;
$$;

revoke all on function confirm_entry_by_token(text) from public;
grant execute on function confirm_entry_by_token(text) to service_role;
