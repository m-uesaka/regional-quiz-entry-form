-- `participants.region_id` の廃止の 2 段階目(#309): 列、
-- `take_over_unverified_participant()` の `p_region_id`、
-- `claim_participant_region_for_tournament()` を消す。
--
-- 1 段階目(0056)は列を nullable にし、同じリリースの Worker が列を読み書き
-- するのをやめた。その時点ではデプロイ中の古い Worker がまだ
--
-- - 参加者の INSERT に `region_id` を付け、
-- - `take_over_unverified_participant()` を `p_region_id` 付き(3 つの引数)で
--   呼び、
-- - `claim_participant_region_for_tournament()` を呼んでいた
--
-- ので、どれも残してあった。このマイグレーションは、1 段階目の Worker が
-- 本番に出て古い Worker がいなくなった後のリリースで当てる。マイグレーションは
-- Worker より先に走るので、1 段階目と同じリリースに入れると、入れ替わる前の
-- 古い Worker の上の 3 つがすべて失敗する。
--
-- 列は 0043 以降どの判定にも使われていない(地域をまたいだ参加はトリガ
-- `check_entry_seat()` が `participant_holds_conflicting_region()` で
-- エントリーそのものを見て断る)。列に依存するのは外部キー
-- `participants_region_id_fkey` とインデックス `participants_region_id_idx`
-- (0022)だけで、ビュー・トリガ・ポリシー・生成列はない。どちらも列と一緒に
-- 消える。

-- 先に関数を消す。plpgsql の本体は列への依存として記録されないので順序は
-- 必須ではないが、列を UPDATE する関数が列より長く残らないようにする。
-- 呼んでいたのは古い Worker だけで、ほかの関数からは呼ばれていない
-- (`check_entry_seat()` の本体のコメントに名前が残るだけ)。判定に使っていた
-- `participant_holds_conflicting_region()` は `check_entry_seat()` が使うので
-- 消さない。
drop function claim_participant_region_for_tournament(uuid, uuid);

alter table participants drop column region_id;

-- 0058 の本体から、使っていなかった引数 `p_region_id` だけを外したもの。
-- 本体は変えていない。
--
-- 引数の数が変わると別の関数になるので、`create or replace` ではなく、3 つの
-- 引数のものを消して作り直す(残すと引数の違う関数が 2 つになり、2 つの
-- 引数での呼び出しを PostgREST がどちらにも解決できない)。権限も新しい関数
-- には引き継がれないので、0034 と同じもの(`service_role` のみ実行可)を
-- 付け直す。1 段階目以降の Worker は 2 つの引数を名前付きで呼んでいるので、
-- 呼び出し側は変えなくてよい。
drop function take_over_unverified_participant(uuid, text, uuid);

create function take_over_unverified_participant(
  p_participant_id uuid,
  p_password_hash text
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

revoke all on function take_over_unverified_participant(uuid, text)
  from public, anon, authenticated;
grant execute on function take_over_unverified_participant(uuid, text)
  to service_role;

-- 関数の引数が変わり、関数が 1 つ消えたことを PostgREST に伝える。
notify pgrst, 'reload schema';
