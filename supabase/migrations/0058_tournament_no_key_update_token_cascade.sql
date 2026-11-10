-- 大会行のロックを `for no key update` にし、確認トークンの外部キーを
-- `on delete cascade` にする(#313)。
--
-- 1. 大会行のロック
--
-- 次の 7 つの関数は、同じ大会への処理を直列化するために `tournaments` の行を
-- `for update` で取っていた。
--
-- - `confirm_entry_by_token()`(0051)
-- - `promote_waitlisted_entries()`(0037)
-- - `cancel_own_entry()`(0006)
-- - `lapse_expired_pending_entries()`(0054)
-- - `reset_tournament_entries()`(0038)
-- - `sync_form_field_defs()`(0002)
-- - `sync_regulations()`(0042)
--
-- `for update` は、行の削除とキー列の書き換えのためのロックで、外部キー検査が
-- 参照先に取る `for key share` とも衝突する。そのため、これらの関数が動いて
-- いる間、同じ大会への新しいエントリーの INSERT(`entries.tournament_id` の
-- 外部キー検査と、`check_entry_seat()` が 0050 から取る `for key share`)が
-- 待たされていた。確認リンクのクリックやキャンセルが続くと、関係のない
-- 新規の申し込みがその後ろに並ぶ。
--
-- どの関数も `tournaments` を書き換えない(確かめたのは、主キー `id` と
-- `unique (region_id, type)` の列。大会行を読むだけで、UPDATE も DELETE も
-- しない)。そこで `reorder_tournaments()`(0032)と同じ `for no key update` に
-- する。
--
-- - `for no key update` どうしは衝突するので、7 つの関数どうしの相互排他は
--   そのまま。大会行の UPDATE(定員や受付期間の変更。キー列を変えなければ
--   `for no key update`、地域・種別を変えれば `for update`)、大会の削除、
--   `reorder_tournaments()` とも今までどおり直列化される
-- - 衝突しなくなるのは `for key share` だけ。つまり、エントリーの INSERT、
--   再エントリー(`check_entry_seat()` の key share)、`regulations` /
--   `form_field_defs` / `mail_jobs` の INSERT の外部キー検査が、これらの
--   関数を待たなくなる
--
-- INSERT を待たせなくなっても困らないことを、関数ごとに確かめた。
--
-- - 確定・繰り上げ・キャンセル・失効: ロックの下で数えるのは `confirmed` と
--   `waitlisted` の行、書き換えるのは既にある行だけ。新しいエントリーは
--   `pending_verification` で入り、定員にも順位にも数えられない(`confirmed` /
--   `waitlisted` にするのは、同じロックを取るこれらの関数だけ)
-- - `sync_regulations()`: 「参照が残っている行は消せない」検査が見るのは
--   `entry_regulations` で、その INSERT は大会行に触れない別のトランザクション
--   なので、0018 の時点で既に大会行のロックでは直列化されていない(0018 の
--   冒頭のコメント)。行き違いは `regulations` の行のロックと外部キーで
--   23503 になり、どちらの側でも扱われている
-- - `sync_form_field_defs()`: `entries` はフォーム定義を外部キーで参照せず、
--   回答の検査は Worker が INSERT の前に済ませている
-- - `reset_tournament_entries()`: 受付期間中は `P0007` で断るので、重なるのは
--   受付の開始・終了の瞬間の行き違いだけ。これまでも INSERT は大会行を待った
--   後に入っていた(リセットのコミット後に 1 件残る)ので、結果は変わらない。
--   参加者を消すときの検査は、これまでどおり参加者行の `for update` が守る。
--   消す参加者の候補は、先に読むのではなく、実際に消したエントリーから取る
--   ようにした(下記)
--
-- これで、エントリーの INSERT と再エントリーが大会行で待つ相手は、大会の
-- 地域・種別の変更(0050)と大会の削除だけになる。
--
-- 2. 確認トークンの外部キー
--
-- `email_verification_tokens.entry_id` の外部キー(0001)は no action だった。
-- エントリーを消す 2 つの関数は、先にトークンを手で消していた。
-- `entry_regulations` と同じ `on delete cascade` にして、エントリーを消せば
-- トークンも消えるようにする。
--
-- 大会の削除には影響しない。`entries.tournament_id` は no action のままで、
-- エントリーのある大会は今までどおり消せない(0023)。参加者の外部キーも
-- 変えない。
--
-- 手書きの削除と、そのためのロックの扱い:
--
-- - `reset_tournament_entries()`: トークンの削除と、`entries` 行の
--   `for update` を**外す**。この `for update` は、トークンの削除とエントリーの
--   削除の間に確認メールの再送・リマインドがトークンを足すのを防ぐためだけの
--   ものだった(0038 の冒頭)。cascade なら間がない。トークンの INSERT は
--   参照先の `entries` 行に key share を取り、エントリーの DELETE はその行の
--   ロックで待つので、
--     - 先に INSERT が来ていれば、DELETE はそのコミットを待ち、cascade が
--       (待った後の新しいスナップショットで)そのトークンごと消す
--     - 先に DELETE が来ていれば、INSERT は待たされ、コミット後に外部キー
--       違反(23503)で失敗する。失敗するのは今までどおり再送の側
--   ほかの競合は、このロックではなく大会行のロック(確定・繰り上げ・
--   キャンセル・失効)か、DELETE 自身が取る行ロック(`updateOwnEntry()` の
--   直接の UPDATE、再エントリー、`take_over_unverified_participant()` の削除)
--   で直列化されていて、外しても変わらない。ロック順(T → E → P)も同じ。
--   0041 に書いた再エントリーとの逆順(受付終了の瞬間だけ)は残る
-- - `take_over_unverified_participant()`: トークンの削除だけを**外す**。
--   トークン行の `for update` は**残す**。これは削除のためだけのものではない。
--     - ロック順。`cancel_own_entry()` と `lapse_expired_pending_entries()` は
--       参加者行を取らずに「トークン行 → 大会行 → `entries` 行」で進む。
--       トークンを先に取らずにエントリーを消すと、cascade が「`entries` 行 →
--       トークン行」の順で取り、逆順になる
--     - 取り下げた大会の一覧(`v_withdrawn`)を、同時の失効・キャンセルが
--       終わった後に読むため(0034)
--   手書きの削除では、ロックの後に足されたトークン(再送)を消しそびれて
--   エントリーの削除が 23503 で失敗することがあったが、cascade では一緒に
--   消える
-- - `reenter_cancelled_entry()`(0057)と `cancel_own_entry()` /
--   `lapse_expired_pending_entries()` は、エントリーを消さずにトークンだけを
--   消す・使用済みにするので変えない。Worker の `rollbackEntry()` も、
--   再エントリーを `cancelled` に戻す経路では行が残るので、トークンの削除を
--   続ける
--
-- デプロイの順序: マイグレーションは Worker より先に走る。どの関数も
-- シグネチャ・戻り値・errcode を変えず、`create or replace` なので既存の
-- `revoke` / `grant`(`service_role` のみ実行可)も残る。古い Worker からも
-- そのまま呼べる。外部キーは同じ名前で張り直す。
--
-- ロック順の表(0041 / 0050)は、`reset_tournament_entries()` 以外は変わらない
-- (0041 の冒頭に追記)。

alter table email_verification_tokens
  drop constraint email_verification_tokens_entry_id_fkey,
  add constraint email_verification_tokens_entry_id_fkey
    foreign key (entry_id) references entries (id) on delete cascade;

-- 以下の関数は、それぞれ最新の本体から大会行のロックの強さだけを変えたもの
-- (`reset_tournament_entries()` と `take_over_unverified_participant()` は
-- 加えて上記の削除とロックを外したもの)。他は変えていない。

-- 0002 の本体。
create or replace function sync_form_field_defs(
  p_tournament_id uuid,
  p_rows jsonb
)
returns void
language plpgsql
as $$
declare
  v_found boolean;
begin
  select true into v_found
    from tournaments where id = p_tournament_id for no key update;
  if v_found is null then
    raise exception 'tournament % not found', p_tournament_id using errcode = 'P0002';
  end if;

  delete from form_field_defs where tournament_id = p_tournament_id;

  insert into form_field_defs (
    tournament_id, field_key, label, field_type, required, options, display_order
  )
  select
    p_tournament_id,
    elem ->> 'field_key',
    elem ->> 'label',
    elem ->> 'field_type',
    (elem ->> 'required')::boolean,
    nullif(elem -> 'options', 'null'::jsonb),
    (elem ->> 'display_order')::integer
  from jsonb_array_elements(p_rows) as elem;
end;
$$;

-- 0042 の本体。
create or replace function sync_regulations(
  p_tournament_id uuid,
  p_regulations jsonb
)
returns void
language plpgsql
as $$
declare
  v_keep uuid[];
  v_unknown uuid[];
  v_in_use text[];
begin
  perform 1 from tournaments where id = p_tournament_id for no key update;
  if not found then
    raise exception 'tournament not found: %', p_tournament_id
      using errcode = 'P0002';
  end if;

  select array_agg(i.id) into v_unknown
  from (
    select (value ->> 'id')::uuid as id
    from jsonb_array_elements(p_regulations)
  ) i
  where i.id is not null
    and not exists (
      select 1 from regulations r
      where r.id = i.id and r.tournament_id = p_tournament_id
    );
  if v_unknown is not null then
    raise exception 'unknown regulations'
      using errcode = 'P0003', detail = array_to_string(v_unknown, ', ');
  end if;

  with input as (
    select
      (e.value ->> 'id')::uuid as id,
      e.value ->> 'label' as label,
      (e.value ->> 'priorityStartsAt')::timestamptz as priority_starts_at,
      (e.value ->> 'priorityEndsAt')::timestamptz as priority_ends_at,
      coalesce(
        (e.value ->> 'closesWithPriority')::boolean,
        (
          select r.closes_with_priority from regulations r
          where r.id = (e.value ->> 'id')::uuid
        ),
        false
      ) and e.value ->> 'priorityStartsAt' is not null as closes_with_priority,
      (e.ordinality - 1)::integer as display_order
    from jsonb_array_elements(p_regulations) with ordinality as e
  ),
  upserted as (
    insert into regulations (
      id, tournament_id, label, priority_starts_at, priority_ends_at,
      closes_with_priority, display_order
    )
    select
      coalesce(i.id, gen_random_uuid()), p_tournament_id, i.label,
      i.priority_starts_at, i.priority_ends_at, i.closes_with_priority,
      i.display_order
    from input i
    on conflict (id) do update set
      label = excluded.label,
      priority_starts_at = excluded.priority_starts_at,
      priority_ends_at = excluded.priority_ends_at,
      closes_with_priority = excluded.closes_with_priority,
      display_order = excluded.display_order
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_keep from upserted;

  -- すべての行が外れる設定だと、外れた後に選べる枠が無くなり、受付中なのに
  -- 誰もエントリーできない。省略したキーは今の値を保つので、入力だけでは
  -- 判断できず、保存後の値で検査する。
  if cardinality(v_keep) > 0 and not exists (
    select 1 from regulations r
    where r.id = any (v_keep) and not r.closes_with_priority
  ) then
    raise exception 'every regulation closes with its priority window'
      using errcode = 'P0009';
  end if;

  select array_agg(r.label order by r.display_order) into v_in_use
  from regulations r
  where r.tournament_id = p_tournament_id
    and not (r.id = any (v_keep))
    and exists (
      select 1 from entry_regulations er where er.regulation_id = r.id
    );
  if v_in_use is not null then
    raise exception 'regulations in use'
      using errcode = 'P0004', detail = array_to_string(v_in_use, '、');
  end if;

  delete from regulations r
  where r.tournament_id = p_tournament_id and not (r.id = any (v_keep));
end;
$$;

-- 0051 の本体。
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

  -- `for no key update` (0058): enough to serialize with every other
  -- function counting or moving this tournament's seats, without making a
  -- new entry's foreign key check wait.
  select capacity into v_capacity
    from tournaments where id = v_tournament_id for no key update;

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

-- 0037 の本体。
create or replace function promote_waitlisted_entries(p_tournament_id uuid)
returns table(entry_id uuid, participant_email text)
language plpgsql
as $$
declare
  v_capacity integer;
  v_free bigint;
begin
  select t.capacity into v_capacity
    from tournaments t where t.id = p_tournament_id for no key update;
  if not found then
    return;
  end if;

  -- null は「上限なし」。`limit null` は件数を制限しない。
  if v_capacity is not null then
    select v_capacity - count(*) into v_free
      from entries e
      where e.tournament_id = p_tournament_id and e.status = 'confirmed';
    if v_free <= 0 then
      return;
    end if;
  end if;

  return query
    with targets as (
      select w.id, w.waitlist_position
        from entries w
        where w.tournament_id = p_tournament_id and w.status = 'waitlisted'
        order by w.waitlist_position asc
        limit v_free
        for update
    ),
    promoted as (
      update entries e
        set status = 'confirmed', waitlist_position = null
        from targets
        where e.id = targets.id
        returning e.id, e.participant_id, targets.waitlist_position
    )
    select promoted.id, p.email
      from promoted
      join participants p on p.id = promoted.participant_id
      order by promoted.waitlist_position asc;

  -- 上の文で確定にした行はもう `waitlisted` ではないので、ここで数えるのは
  -- 残った行だけ。元の順(同じ番号があれば id 順)を保ったまま詰める。
  update entries e
    set waitlist_position = renumbered.n
    from (
      select w.id, row_number() over (
          order by w.waitlist_position asc, w.id asc
        )::integer as n
        from entries w
        where w.tournament_id = p_tournament_id and w.status = 'waitlisted'
    ) renumbered
    where e.id = renumbered.id
      and e.waitlist_position is distinct from renumbered.n;
end;
$$;

-- 0006 の本体。
create or replace function cancel_own_entry(
  p_entry_id uuid,
  p_participant_id uuid
)
returns table(previous_status entry_status, entry_tournament_id uuid)
language plpgsql
as $$
declare
  v_tournament_id uuid;
  v_status entry_status;
  v_waitlist_position integer;
begin
  select e.tournament_id into v_tournament_id
    from entries e
    where e.id = p_entry_id and e.participant_id = p_participant_id;

  if v_tournament_id is null then
    return;
  end if;

  update email_verification_tokens
    set used_at = now()
    where entry_id = p_entry_id and used_at is null;

  perform 1 from tournaments t
    where t.id = v_tournament_id for no key update;

  -- Re-read under the lock: a concurrent confirmation, promotion or
  -- cancellation may have moved the entry since the lookup above.
  select e.status, e.waitlist_position into v_status, v_waitlist_position
    from entries e
    where e.id = p_entry_id;

  if v_status <> 'cancelled' then
    update entries
      set status = 'cancelled',
          cancelled_at = now(),
          waitlist_position = null
      where id = p_entry_id;

    if v_waitlist_position is not null then
      update entries e
        set waitlist_position = e.waitlist_position - 1
        where e.tournament_id = v_tournament_id
          and e.status = 'waitlisted'
          and e.waitlist_position > v_waitlist_position;
    end if;
  end if;

  previous_status := v_status;
  entry_tournament_id := v_tournament_id;
  return next;
end;
$$;

-- 0054 の本体。
create or replace function lapse_expired_pending_entries(
  p_participant_id uuid
)
returns setof uuid
language plpgsql
as $$
declare
  v_entry record;
begin
  for v_entry in
    select e.id, e.tournament_id
      from entries e
      where e.participant_id = p_participant_id
        and e.status = 'pending_verification'
        and (
          exists (
            select 1 from email_verification_tokens evt
              where evt.entry_id = e.id
          )
          or e.updated_at < now() - interval '24 hours'
        )
        and not exists (
          select 1 from email_verification_tokens evt
            where evt.entry_id = e.id
              and evt.used_at is null
              and evt.expires_at >= now()
        )
      order by e.tournament_id, e.id
  loop
    perform 1 from email_verification_tokens evt
      where evt.entry_id = v_entry.id
      for update;

    perform 1 from tournaments t
      where t.id = v_entry.tournament_id for no key update;

    -- Re-checked under the locks: the entry may have been confirmed or
    -- cancelled, rewritten by a re-entry, or given a fresh link, since the
    -- candidates were read.
    if exists (
      select 1 from entries e
        where e.id = v_entry.id
          and e.status = 'pending_verification'
          and (
            exists (
              select 1 from email_verification_tokens evt
                where evt.entry_id = e.id
            )
            or e.updated_at < now() - interval '24 hours'
          )
    ) and not exists (
      select 1 from email_verification_tokens evt
        where evt.entry_id = v_entry.id
          and evt.used_at is null
          and evt.expires_at >= now()
    ) then
      update entries
        set status = 'cancelled',
            cancelled_at = now(),
            waitlist_position = null
        where id = v_entry.id;

      update email_verification_tokens
        set used_at = now()
        where entry_id = v_entry.id and used_at is null;

      return next v_entry.id;
    end if;
  end loop;
end;
$$;

-- 0038 の本体から、トークンの削除と `entries` 行の `for update` を外し、消す
-- 参加者の候補を、消したエントリーから取るようにしたもの。
--
-- 候補を先に読んでいたのは、`entries` 行のロックの下でだった。そのロックを
-- 外し、大会行のロックも INSERT を待たせなくなったので、先に読むと、読んだ
-- 後にコミットされたエントリーは消すのに、その参加者は候補に入らない。消した
-- 行そのものから取れば、件数と候補が必ず揃う。
create or replace function reset_tournament_entries(
  p_tournament_id uuid,
  p_delete_participants boolean
)
returns table(
  deleted_entry_count integer,
  deleted_participant_count integer,
  kept_participant_count integer
)
language plpgsql
as $$
declare
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_participant_ids uuid[];
  v_deleted_entries integer;
  v_deleted_participants integer := 0;
  v_kept_participants integer := 0;
begin
  select t.entry_opens_at, t.entry_closes_at
    into v_opens_at, v_closes_at
    from tournaments t where t.id = p_tournament_id for no key update;
  if not found then
    return;
  end if;
  if now() between v_opens_at and v_closes_at then
    raise exception 'the entry period of the tournament is open'
      using errcode = 'P0007';
  end if;

  -- `email_verification_tokens` and `entry_regulations` go with each row
  -- (`on delete cascade`, 0058 and 0018). A token a resend is inserting
  -- right now holds a key share lock on its entry: this delete waits for
  -- it, and the cascade then takes the token too.
  with deleted as (
    delete from entries e
      where e.tournament_id = p_tournament_id
      returning e.participant_id
  )
  select coalesce(array_agg(distinct d.participant_id), '{}'::uuid[]),
         count(*)::integer
    into v_participant_ids, v_deleted_entries
    from deleted d;

  if p_delete_participants and cardinality(v_participant_ids) > 0 then
    perform 1 from participants p
      where p.id = any (v_participant_ids)
      order by p.id
      for update;

    delete from password_reset_tokens prt
      where prt.participant_id = any (v_participant_ids)
        and not exists (
          select 1 from entries e where e.participant_id = prt.participant_id
        );

    delete from participants p
      where p.id = any (v_participant_ids)
        and not exists (
          select 1 from entries e where e.participant_id = p.id
        );
    get diagnostics v_deleted_participants = row_count;

    select count(*) into v_kept_participants
      from participants p where p.id = any (v_participant_ids);
  end if;

  return query
    select v_deleted_entries, v_deleted_participants, v_kept_participants;
end;
$$;

-- 0056 の本体から、トークンの手書きの削除だけを外したもの。トークン行の
-- ロックは残す(冒頭のコメント)。`p_region_id` は 0056 と同じく受け取るだけで
-- 使わない(古い Worker との互換。#309 の 2 段階目で削除する)。
create or replace function take_over_unverified_participant(
  p_participant_id uuid,
  p_password_hash text,
  p_region_id uuid default null
)
returns uuid[]
language plpgsql
as $$
declare
  v_withdrawn uuid[];
begin
  perform 1 from participants p
    where p.id = p_participant_id
      and p.email_verified_at is null
    for no key update;

  if not found then
    return null;
  end if;

  -- Belt and braces: an entry only ever gets `email_verified_at` from
  -- `confirm_entry_by_token()`, which verifies the participant in the same
  -- transaction, so this only matters for a row the 0034 backfill missed.
  -- A statement of its own rather than part of the locking query above: a
  -- query that had to wait for the lock re-checks only the locked row's own
  -- columns against what committed meanwhile (READ COMMITTED's
  -- EvalPlanQual), and would judge `entries` by the snapshot it started
  -- with. This statement starts after the lock is held and sees every
  -- confirmation committed before it.
  if exists (
    select 1 from entries e
      where e.participant_id = p_participant_id
        and e.email_verified_at is not null
  ) then
    return null;
  end if;

  update participants
    set password_hash = p_password_hash,
        password_changed_at = now()
    where id = p_participant_id;

  -- Kept although the delete below would take the tokens by itself
  -- (`on delete cascade`, 0058): a cancellation or a lapse locks the tokens
  -- before the entry, and the cascade alone would take them after it.
  perform 1 from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where e.participant_id = p_participant_id
    order by e.tournament_id, e.id, evt.id
    for update of evt;

  -- Read after the token locks, so an entry a concurrent lapse or
  -- cancellation moved out of `pending_verification` meanwhile is not
  -- reported as withdrawn by this call.
  v_withdrawn := array(
    select e.tournament_id from entries e
      where e.participant_id = p_participant_id
        and e.status = 'pending_verification'
      order by e.tournament_id
  );

  -- `email_verification_tokens` and `entry_regulations` go with each row
  -- (`on delete cascade`, 0058 and 0018), including a token a resend
  -- inserted after the locks above.
  delete from entries e where e.participant_id = p_participant_id;

  return v_withdrawn;
end;
$$;
