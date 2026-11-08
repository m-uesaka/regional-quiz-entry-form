-- 確認リンクで確定するエントリーが、キャンセル待ちを追い越さないようにする
-- (#283)。
--
-- これまでの `confirm_entry_by_token()`(0034)は「確定数 < 定員」だけで
-- 確定にするかを決めていた。席を空ける操作(確定済みエントリーのキャンセル
-- `cancel_own_entry()`、大会の編集での定員の変更、一括登録の上書き
-- `import_tournament()`)はそれだけで先にコミットされ、繰り上げ
-- (`promote_waitlisted_entries()`、0037)はその後に別の RPC で走る。その間に
-- 確認リンクを踏んだ新規の申込者が空席に入り、前から待っていたキャンセル待ちの
-- 先頭が繰り上がらなかった。繰り上げの RPC が失敗したときは空席が残り、次に
-- 確認した人が順番を無視してその席を取っていた。
--
-- 同じ大会にキャンセル待ちが 1 件でもあれば、空席があっても新しいエントリーは
-- キャンセル待ちの末尾に入れる。空席は `promote_waitlisted_entries()` が
-- `waitlist_position` の順に埋める。キャンセル待ちの件数は、確定数と同じく
-- 大会の行のロックを取った後に数える。キャンセル待ちを動かす関数
-- (`cancel_own_entry()`、`promote_waitlisted_entries()`、
-- `lapse_expired_pending_entries()`)はどれも同じ大会の行のロックを取るので、
-- 数え終えてから採番するまでの間にキャンセル待ちが変わることはない。
--
-- 定員なし(`capacity` が null)の大会でも規則は同じにする。定員なしの大会に
-- キャンセル待ちが残るのは、定員を外した後の繰り上げが失敗したときだけで、
-- 定員をもう一度保存すれば(`PATCH /api/tournaments/:id`)残った全員が
-- 順番どおりに確定する。
--
-- 対象外: 席を空ける操作と繰り上げを同じトランザクションにまとめること
-- (`cancel_own_entry()` の中で繰り上げる等)。返り値の形と、繰り上げの
-- 通知メールを送るアプリ側の流れが変わるので別に扱う。この変更の後は、
-- 繰り上げが失敗しても空席が順番を無視して取られることはなく、空いたまま
-- 次の繰り上げ(次のキャンセルや定員の保存)で順番どおりに埋まる。
--
-- 関数のシグネチャと返り値は変えないので、デプロイ中の古い Worker からも
-- そのまま呼べる。

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

  select count(*) into v_confirmed_count
    from entries
    where tournament_id = v_tournament_id and status = 'confirmed';
  select count(*) into v_waitlisted_count
    from entries
    where tournament_id = v_tournament_id and status = 'waitlisted';

  -- Anyone already waiting goes first: a seat freed by a cancellation or a
  -- raised capacity belongs to the head of the queue, which
  -- `promote_waitlisted_entries()` fills in order. So a non-empty queue
  -- sends this entry to its tail even when a seat is free right now.
  if v_waitlisted_count > 0
      or (v_capacity is not null and v_confirmed_count >= v_capacity) then
    v_status := 'waitlisted';
    v_waitlist_position := v_waitlisted_count + 1;
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
