-- 大会ごとに参加者データ(エントリー)をリセットできるようにする。統括
-- スタッフだけが `POST /api/tournaments/:id/reset` から呼ぶ(地域スタッフが
-- 誤って実行すると取り返しがつかないため、API 側で統括スタッフに限る)。
--
-- 消すもの:
--
--   * その大会の `entries` 全件(キャンセル済みも含む)。`entry_regulations`
--     は `on delete cascade`(0018)で一緒に消える。
--   * それらのエントリーの `email_verification_tokens`。`entries` を
--     no action で参照しているので、先に消す。
--   * `p_delete_participants` が true のとき、それらのエントリーの参加者
--     アカウント(`participants`)と、その `password_reset_tokens`。ただし
--     **他の大会にエントリーが残っている参加者は消さない**。同じ地域の
--     もう一方の大会(重複エントリーを認める地域)にエントリーしている人の
--     アカウントまで消すと、その大会のエントリーが外部キーで消せない・
--     マイページに入れない、という形で別の大会を壊してしまうため。
--
-- 消さないもの: 大会そのもの・レギュレーション・フォーム定義・一斉メールの
-- 記録(`mail_jobs`)。大会の設定を残したまま、次の開催に向けてエントリー
-- だけを空にするための機能なので。
--
-- 大会の行を `for update` でロックしてから消す。確認リンクでの確定・
-- キャンセル待ちの繰り上げ(`promote_waitlisted_entries()`、0037)も同じ
-- ロックを取るので、それらと行き違いにならない。参加者を消すときは、
-- 消す候補の `participants` 行も `for update` でロックしてから「他の大会に
-- エントリーが残っていないか」を見る。エントリーの insert は参照先の参加者
-- 行に key share ロックを取るので、同時に別の大会へ入ってきたエントリーは
-- このロックを待たせ、その後の検査で見える(read committed の各文は、
-- それより前にコミットされたものを見る)。そのため、検査をすり抜けた
-- エントリーが外部キー違反で全体を失敗させることはない。
--
-- 返り値は 1 行で、消したエントリー数・消した参加者数・他の大会にエントリーが
-- 残っているため残した参加者数。大会が無ければ 0 行を返す(API は 404)。
create function reset_tournament_entries(
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
  v_participant_ids uuid[];
  v_deleted_entries integer;
  v_deleted_participants integer := 0;
  v_kept_participants integer := 0;
begin
  perform 1 from tournaments t where t.id = p_tournament_id for update;
  if not found then
    return;
  end if;

  v_participant_ids := array(
    select distinct e.participant_id from entries e
      where e.tournament_id = p_tournament_id
  );

  delete from email_verification_tokens evt
    using entries e
    where e.id = evt.entry_id and e.tournament_id = p_tournament_id;

  delete from entries e where e.tournament_id = p_tournament_id;
  get diagnostics v_deleted_entries = row_count;

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

    v_kept_participants := cardinality(v_participant_ids) - v_deleted_participants;
  end if;

  return query
    select v_deleted_entries, v_deleted_participants, v_kept_participants;
end;
$$;

revoke all on function reset_tournament_entries(uuid, boolean) from public;
grant execute on function reset_tournament_entries(uuid, boolean)
  to service_role;
