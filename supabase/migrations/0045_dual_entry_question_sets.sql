-- 重複エントリーを認める地域では、最強位と新人王に同じ問題セットを設定
-- できないようにする。
--
-- 同じ問題を使う 2 大会の両方に出られると、片方で見た問題がもう片方でも
-- 出る。地域をまたいだ参加を問題セットで断る(0043)のと同じ理由で、
-- 同じ地域の 2 大会でも、両方に出られるなら問題セットは違わなければ
-- ならない。重複エントリーを認めない地域では、どのみち片方にしか出られない
-- ので制限しない。
--
-- 「同じ問題セットか」は `same_question_set()` の 1 か所で決め、ここの
-- トリガと検査、地域をまたいだ判定(0046 の
-- `participant_holds_conflicting_region()`)がすべてこれを呼ぶ。名前を設定した
-- 問題セットは名前で比べ、null(共通問題)は種別ごとに別の問題セットとする
-- (最強位と新人王は基本的に問題を共通にしない)。同じ地域の 2 大会は種別が
-- 違うので、共通問題どうしがここで同じになることはない。既存の地域はすべて
-- 最強位・新人王とも null のまま重複エントリーを認めているが、それは
-- そのまま通る。
--
-- 検査は 2 か所で行い、どちらも SQLSTATE `P0010` で断る。
--
-- - 大会の問題セットか地域が変わるとき(`tournaments` のトリガ)。種別は
--   判定を変えないので見ない(同じ地域の 2 大会は必ず種別が違う)
-- - 地域が重複エントリーを認めるように変わるとき(`regions` のトリガ)
--
-- 同じ地域の 2 大会への同時の変更や、地域の設定の変更と大会の変更が
-- 同時に来ても検査をすり抜けないよう、どちらも地域行を
-- `for no key update` で取ってから、別の文で相手を読む。`regions` の
-- UPDATE は自分で同じ行ロックを取るので、トリガの中では取り直さない。
-- 大会の INSERT が地域行に取る外部キー検査の `for key share` とは衝突しない。
-- 地域行を取る経路はこの 2 つだけで、エントリーまわりのロック順
-- (参加者行・トークン行・大会行・`entries` 行)には関わらない。編集画面は
-- 保存のたびに全項目を送るので、問題セットも地域も変わらない UPDATE では
-- 地域行を取らずに抜ける。

create function same_question_set(
  p_question_set_a text,
  p_type_a tournament_type,
  p_question_set_b text,
  p_type_b tournament_type
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_question_set_a = p_question_set_b, false)
    or (
      p_question_set_a is null
      and p_question_set_b is null
      and p_type_a = p_type_b
    );
$$;

revoke all on function same_question_set(
  text, tournament_type, text, tournament_type
) from public;
grant execute on function same_question_set(
  text, tournament_type, text, tournament_type
) to service_role;

create function check_tournament_question_set_for_dual_entry()
returns trigger
language plpgsql
as $$
declare
  v_allows_dual_entry boolean;
begin
  if new.question_set is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.question_set is not distinct from old.question_set
    and new.region_id = old.region_id
  then
    return new;
  end if;

  select r.allows_dual_entry into v_allows_dual_entry
    from regions r
    where r.id = new.region_id
    for no key update;

  -- No row: the region doesn't exist, which the foreign key refuses next.
  if v_allows_dual_entry is not true then
    return new;
  end if;

  if exists (
    select 1 from tournaments t
      where t.region_id = new.region_id
        and t.id <> new.id
        and same_question_set(t.question_set, t.type, new.question_set, new.type)
  ) then
    raise exception 'dual entry tournaments share a question set'
      using errcode = 'P0010';
  end if;

  return new;
end;
$$;

create trigger tournaments_check_question_set_for_dual_entry
  before insert or update of region_id, question_set on tournaments
  for each row
  execute function check_tournament_question_set_for_dual_entry();

-- `p_region_id` の大会のうち、同じ問題セットの組があるか。
create function region_has_shared_question_set(p_region_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from tournaments a
      join tournaments b on b.region_id = a.region_id and b.id > a.id
      where a.region_id = p_region_id
        and same_question_set(a.question_set, a.type, b.question_set, b.type)
  );
$$;

revoke all on function region_has_shared_question_set(uuid) from public;
grant execute on function region_has_shared_question_set(uuid)
  to service_role;

create function check_region_dual_entry_question_sets()
returns trigger
language plpgsql
as $$
begin
  if not new.allows_dual_entry or old.allows_dual_entry then
    return new;
  end if;

  if region_has_shared_question_set(new.id) then
    raise exception 'dual entry tournaments share a question set'
      using errcode = 'P0010';
  end if;

  return new;
end;
$$;

create trigger regions_check_dual_entry_question_sets
  before update of allows_dual_entry on regions
  for each row
  execute function check_region_dual_entry_question_sets();

-- 既に矛盾している地域があれば、ここで止める。直してから適用し直す。
do $$
declare
  v_regions text;
begin
  select string_agg(r.name, ', ' order by r.name)
    into v_regions
    from regions r
    where r.allows_dual_entry
      and region_has_shared_question_set(r.id);
  if v_regions is not null then
    raise exception
      'regions allowing dual entry already share a question set: %',
      v_regions;
  end if;
end;
$$;
