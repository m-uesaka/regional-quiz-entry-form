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
-- 変更が必要なら、参加者データのリセット(`reset_tournament_entries()`、
-- 0038)でエントリーを消してから行う。
--
-- `question_set` の変更を検査し直さないのは 0043 で決めた仕様なので、ここでは
-- 扱わない。
--
-- 編集画面は保存のたびに `region_id` と `type` も送るので、`update of` だけ
-- では値が変わらない保存まで断ってしまう。`when` で値が変わったときだけに
-- 絞る。
--
-- 同時に走るエントリーの書き込みとは、大会の行のロックで直列化される。
-- `region_id` と `type` は `unique (region_id, type)` の列なので、この UPDATE は
-- 大会の行を `for update` で取る。エントリーの INSERT は外部キー検査で同じ行を
-- `for key share` で取るので、互いに相手のコミットを待つ。トリガは行を
-- 取った後に動き、関数内の問い合わせはそのときのスナップショットで読むので、
-- 先にコミットしたエントリーを見落とさない(後から来たエントリーは、移った
-- 先の地域で `check_entry_seat()` に検査される)。
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
