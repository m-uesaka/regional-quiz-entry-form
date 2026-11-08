-- 重複エントリーを認める地域では、最強位と新人王に同じ問題セットを設定
-- できないようにする。
--
-- 同じ問題を使う 2 大会の両方に出られると、片方で見た問題がもう片方でも
-- 出る。地域をまたいだ参加を問題セットで断る(0043)のと同じ理由で、
-- 同じ地域の 2 大会でも、両方に出られるなら問題セットは違わなければ
-- ならない。重複エントリーを認めない地域では、どのみち片方にしか出られない
-- ので制限しない。
--
-- 比べるのは名前を設定した問題セット(null 以外)どうしだけ。null は共通問題
-- で、既存の地域はすべて最強位・新人王とも null のまま重複エントリーを
-- 認めているので、null どうしは同じ問題セットとは扱わない(共通問題は
-- 最強位用と新人王用で別の問題を使う)。
--
-- 検査は 2 か所で行い、どちらも SQLSTATE `P0010` で断る。
--
-- - 大会の問題セット・地域・種別が変わるとき(`tournaments` のトリガ)
-- - 地域が重複エントリーを認めるように変わるとき(`regions` のトリガ)
--
-- 同じ地域の 2 大会への同時の変更や、地域の設定の変更と大会の変更が
-- 同時に来ても検査をすり抜けないよう、どちらも地域行を
-- `for no key update` で取ってから、別の文で相手を読む。`regions` の
-- UPDATE は自分で同じ行ロックを取るので、トリガの中では取り直さない。
-- 大会の INSERT が地域行に取る外部キー検査の `for key share` とは衝突しない。
-- 地域行を取る経路はこの 2 つだけで、エントリーまわりのロック順
-- (参加者行・トークン行・大会行・`entries` 行)には関わらない。

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

  select r.allows_dual_entry into v_allows_dual_entry
    from regions r
    where r.id = new.region_id
    for no key update;

  if not v_allows_dual_entry then
    return new;
  end if;

  if exists (
    select 1 from tournaments t
      where t.region_id = new.region_id
        and t.id <> new.id
        and t.question_set = new.question_set
  ) then
    raise exception 'dual entry tournaments share a question set'
      using errcode = 'P0010';
  end if;

  return new;
end;
$$;

create trigger tournaments_check_question_set_for_dual_entry
  before insert or update of region_id, type, question_set on tournaments
  for each row
  execute function check_tournament_question_set_for_dual_entry();

create function check_region_dual_entry_question_sets()
returns trigger
language plpgsql
as $$
begin
  if not new.allows_dual_entry or old.allows_dual_entry then
    return new;
  end if;

  if exists (
    select 1 from tournaments t
      where t.region_id = new.id
        and t.question_set is not null
      group by t.question_set
      having count(*) > 1
  ) then
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
  select string_agg(distinct r.name, ', ')
    into v_regions
    from regions r
    join tournaments t on t.region_id = r.id
    where r.allows_dual_entry
      and t.question_set is not null
      and exists (
        select 1 from tournaments other
          where other.region_id = t.region_id
            and other.id <> t.id
            and other.question_set = t.question_set
      );
  if v_regions is not null then
    raise exception
      'regions allowing dual entry already share a question set: %',
      v_regions;
  end if;
end;
$$;
