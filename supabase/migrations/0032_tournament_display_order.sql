-- 大会の表示順 `tournaments.display_order` と、統括スタッフがそれを並べ替える
-- `reorder_tournaments()`。
--
-- これまで大会は地域名 → 種別の順に並べていた(ポータルは日本語の照合順、
-- ダッシュボードはこのファイルで置き換える `tournament_entry_summary()` の
-- `order by r.name, t.type`)。以後はポータル・エントリーリスト一覧・
-- ダッシュボード・管理画面の大会一覧のどれも `display_order` の昇順に並べる。
--
-- 既存の大会には、ポータルがこれまで並べていた順(地域名の日本語の照合順 →
-- 地域の slug → 種別)に 0 から番号を振る。参加者が見るポータルの並びを
-- デプロイで変えないためで、地域名は `ja-x-icu` で比べる(ポータルの
-- `localeCompare(..., 'ja')` と同じ順になる)。種別の enum は最強位・新人王の
-- 順に定義されている(0001)ので、そのまま比べればポータルと同じ順になる。
--
-- 新しく作られた大会は列の既定値(シーケンス)で末尾に付く。大会の作成
-- (`POST /api/tournaments`)と一括登録(`import_tournament()`、0028)の
-- どちらも列を指定しないので、どちらにも手を入れずに済む。並べ替えは 0 から
-- 振り直すだけで、シーケンスは常にそれより大きい値を返すので、並べ替えた
-- 後に作った大会も末尾に付く。
alter table tournaments add column display_order integer;

update tournaments t
  set display_order = o.n
  from (
    select t2.id, (row_number() over (
        order by r.name collate "ja-x-icu", r.slug, t2.type, t2.id
      ) - 1)::integer as n
      from tournaments t2
      join regions r on r.id = t2.region_id
  ) o
  where o.id = t.id;

-- 大会がまだ 1 つも無いデータベース(新しく作った環境や CI)では、最初の
-- 大会に 0 を振ることになるので、最小値を 0 にしておく(既定の最小値は 1 で、
-- `setval` が 0 を範囲外として断る)。
create sequence tournaments_display_order_seq
  as integer
  minvalue 0
  owned by tournaments.display_order;
select setval(
  'tournaments_display_order_seq',
  coalesce((select max(display_order) from tournaments), -1) + 1,
  false
);

alter table tournaments
  alter column display_order
    set default nextval('tournaments_display_order_seq'),
  alter column display_order set not null;

-- 統括スタッフが決めた順に並べ直す。`p_tournament_ids` は全大会の id を
-- 表示したい順に並べたもので、その順に 0 から番号を振る。
--
-- 渡された id が今ある大会とちょうど一致しない(足りない・余分・重複が
-- ある)ときは何も書かずに SQLSTATE `P0003` で断る。並べ替え画面を開いた後に
-- 別の統括スタッフが大会を作成・削除していた場合で、画面に無い大会の位置を
-- 勝手に決めないためである。
--
-- 全大会の行を id 順にロックしてから照合する。エントリー処理が大会の行を
-- 複数ロックするとき(`lapse_expired_pending_entries()`、0030)と同じ順なので、
-- 互いにデッドロックしない。書き換えるのはキーでない `display_order` だけ
-- なので、ロックは `for no key update` にする。`for update` だと、エントリーの
-- 行を書くときの外部キーの確認(大会の行への `for key share`)まで待たせて
-- しまう。並べ替え同士は、このロックどうしで順に処理される。
create function reorder_tournaments(p_tournament_ids uuid[])
returns void
language plpgsql
as $$
begin
  perform 1 from tournaments order by id for no key update;

  if cardinality(p_tournament_ids) is distinct from (select count(*) from tournaments)
    or cardinality(p_tournament_ids) <> (
      select count(distinct i) from unnest(p_tournament_ids) as i
    )
    or exists (
      select 1 from tournaments t where t.id <> all (p_tournament_ids)
    )
  then
    raise exception 'the tournament ids do not match the tournaments'
      using errcode = 'P0003';
  end if;

  update tournaments t
    set display_order = (o.ordinality - 1)::integer
    from unnest(p_tournament_ids) with ordinality as o(id, ordinality)
    where t.id = o.id;
end;
$$;

revoke all on function reorder_tournaments(uuid[]) from public;
grant execute on function reorder_tournaments(uuid[]) to service_role;

-- ダッシュボードの集計を `display_order` の順に返すようにする。中身は
-- 0013 と同じで、`order by` だけを変えている。
create or replace function tournament_entry_summary()
returns table (
  tournament_id uuid,
  tournament_name text,
  tournament_type tournament_type,
  region_id uuid,
  region_slug text,
  region_name text,
  capacity integer,
  confirmed_count integer,
  waitlisted_count integer,
  pending_verification_count integer,
  cancelled_count integer
)
language sql
stable
as $$
  select
    t.id,
    t.name,
    t.type,
    r.id,
    r.slug,
    r.name,
    t.capacity,
    count(*) filter (where e.status = 'confirmed')::integer,
    count(*) filter (where e.status = 'waitlisted')::integer,
    count(*) filter (where e.status = 'pending_verification')::integer,
    count(*) filter (where e.status = 'cancelled')::integer
  from tournaments t
  join regions r on r.id = t.region_id
  left join entries e on e.tournament_id = t.id
  group by t.id, r.id
  order by t.display_order, t.id;
$$;
