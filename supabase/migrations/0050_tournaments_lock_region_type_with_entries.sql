-- エントリーのある大会の地域・種別を変更できないようにする(#284)。
--
-- 地域をまたぐ重複エントリーと、重複エントリーを認めない地域での 2 大会への
-- 参加は、`entries` への書き込みのときに `check_entry_seat()`(0041、判定は
-- 0043/0045/0046 の `participant_holds_conflicting_region()` /
-- `same_question_set()`)が検査している。ところが大会の編集
-- (`PATCH /api/tournaments/:id`)は `region_id` と `type` をそのまま書き換える
-- ので、エントリーのある大会を別の地域に移すと、既存のエントリーが検査なしで
-- 移った先の地域のものになる。
--
-- - 移った先の地域の、同じ問題セットの大会にもエントリーしている参加者が、
--   地域をまたいで 2 枠を持つ
-- - 重複エントリーを認めない地域で、同じ参加者が 2 大会に参加中になる
-- - 元の地域の地域スタッフからエントリーが見えなくなる
-- - `type` の変更は、共通問題(`question_set` が null)どうしの判定
--   (`same_question_set()`、0046)の結果を変える
--
-- 移した後のエントリーを検査し直して断る代わりに、エントリーが 1 件でも
-- ある大会では `region_id` と `type` の変更そのものを断る。キャンセル済みの
-- エントリーも数える。受付終了より後にキャンセルした確定済みのエントリーは
-- 地域を押さえ続けるうえ(0040)、どの地域のスタッフに見えるかも変わるため。
-- 参加者データのリセット(`reset_tournament_entries()`、0038)でエントリーを
-- 消せば変更できるが、リセットは受付期間中には断られる(`P0007`)。
--
-- `question_set` の変更を検査し直さないのは 0043 で決めた仕様なので、ここでは
-- 扱わない。
--
-- 編集画面は保存のたびに `region_id` と `type` も送るので、`update of` だけ
-- では値が変わらない保存まで断ってしまう。`when` で値が変わったときだけに
-- 絞る。
--
-- 同時に走るエントリーの書き込みとは、大会の行のロックで直列化する。
-- `region_id` と `type` は `unique (region_id, type)` の列なので、この UPDATE は
-- 大会の行を `for update` で取る。これと衝突するのは `for key share` で、
-- エントリーの INSERT は外部キー検査でこれを取る。ただし外部キー検査は文の
-- 最後(AFTER トリガ)なので、それだけでは足りない。
--
-- - エントリーが先に行を取った場合: 移動の UPDATE はエントリーのコミットを
--   待ち、行を取った後にこのトリガが動く。トリガの問い合わせはその時点の
--   スナップショットで読むので、コミットされたエントリーが見えて `P0011` に
--   なる。
-- - 移動が先に行を取った場合(エントリーがまだなく、移動は未コミット): 0043 の
--   `check_entry_seat()` は大会の行をロックせずに読むので、移動前の地域で
--   検査を通し、その後の外部キー検査で移動のコミットを待ってから、移った先の
--   地域のエントリーとして入ってしまう。検査を通らないエントリーが残るので、
--   下で `check_entry_seat()` を置き換え、参加者行を取った直後に大会の行を
--   `for key share` で取ってから読むようにする。移動のコミットを待った後の
--   各文は新しいスナップショットで読むので(read committed)、エントリーは
--   移った先の地域と種別で検査される。
--
-- ロック順(0041 の表の記号。P: 参加者行、T: 大会行、E: `entries` 行)。
-- 大会の行は、トリガの中で参加者行の後に取る。
--
-- - エントリーの INSERT: P → T(key share)。外部キー検査が今まで取っていた
--   順と同じで、それを前に出すだけ
-- - `reenter_cancelled_entry()`: P → Tk → E → T(key share、新しく取る)。
--   key share と衝突するのは T の `for update`(と行の削除、キー列の更新)
--   だけ。T を `for update` で持ったまま E を取りに行く関数のうち、
--   `confirm_entry_by_token()` は P を先に取るので同じ参加者とは P で
--   直列化され、別の参加者なら E が別の行になる。`cancel_own_entry()` と
--   `lapse_expired_pending_entries()` は、T の後で `cancelled` でない行しか
--   更新しないので、再エントリー中(未コミットでまだ `cancelled` の)行を
--   待たない。`promote_waitlisted_entries()` が更新するのはキャンセル待ちの
--   行だけ。どれも再エントリーとの間に待ちの輪はできない
-- - `reset_tournament_entries()` の T → E → P との逆順は 0038 / 0041 から
--   あるもので(受付期間外にしか動かない)、変わらない
-- - 大会の UPDATE は T だけを取り(0045 のトリガは地域行を取るが、エントリーの
--   書き込みは地域行をロックしない)、`reorder_tournaments()`(0032)の
--   `for no key update` と `entries_paused` の更新は key share と衝突しない
--
-- `check_entry_seat()` の置き換えはロックの 1 文を足すだけで、シグネチャ・
-- 検査の順・errcode は変えない。古い Worker からの書き込みも同じトリガを通る。
--
-- 断るときは専用の SQLSTATE `P0011` を使い(`lib/pg-errors.ts` の
-- `TOURNAMENT_REGION_TYPE_LOCKED_SQLSTATE`)、API はそれを 409 に対応付ける。
-- 既存の行はそのまま(新しく検査するのは今後の変更だけ)なので、適用前に
-- 確かめるべきデータはない。
create function check_tournament_region_type_change()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from entries e where e.tournament_id = old.id) then
    raise exception 'the region and type of a tournament with entries are locked'
      using errcode = 'P0011';
  end if;
  return new;
end;
$$;

revoke all on function check_tournament_region_type_change() from public;

create trigger tournaments_lock_region_type_with_entries
  before update of region_id, type on tournaments
  for each row
  when (
    new.region_id is distinct from old.region_id
    or new.type is distinct from old.type
  )
  execute function check_tournament_region_type_change();

-- 0043 の本体に、大会の行を `for key share` で取る 1 文を足したもの(上の
-- 「移動が先に行を取った場合」)。それ以外は変えない。ロックは読み取りとは
-- 別の文で取る。`regions` と結合した文のまま `for key share of t` で待つと、
-- 待った後の再評価が新しい大会行を移動前の地域行と結合し直し、行が落ちる。
create or replace function check_entry_seat()
returns trigger
language plpgsql
as $$
declare
  v_tournament_region_id uuid;
  v_allows_dual_entry boolean;
begin
  -- Only a write *taking* a seat is checked: see 0041.
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelled' then
    return new;
  end if;

  -- The participant is the contended resource: every check below runs under
  -- this lock, which is what serializes it with a concurrent submission's
  -- write and with `claim_participant_region_for_tournament()`.
  perform 1
    from participants p
    where p.id = new.participant_id
    for no key update;

  -- The tournament's region and type are read under this lock (0050, #284):
  -- a move of the tournament holds the row `for update` until it commits,
  -- and the statements after this one see where it moved to. Taken after
  -- the participant, the order the foreign key check already takes them in.
  perform 1
    from tournaments t
    where t.id = new.tournament_id
    for key share;

  select t.region_id, r.allows_dual_entry
    into v_tournament_region_id, v_allows_dual_entry
    from tournaments t
    join regions r on r.id = t.region_id
    where t.id = new.tournament_id;

  -- A statement of its own after the lock, so it sees what a concurrent
  -- submission committed while this one waited.
  if participant_holds_conflicting_region(new.participant_id, new.tournament_id)
  then
    raise exception 'participant belongs to another region'
      using errcode = 'P0008';
  end if;

  if v_allows_dual_entry then
    return new;
  end if;

  if exists (
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      where e.participant_id = new.participant_id
        and t.region_id = v_tournament_region_id
        and e.tournament_id <> new.tournament_id
        and e.status <> 'cancelled'
  ) then
    raise exception 'already entered another tournament in this region'
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;
