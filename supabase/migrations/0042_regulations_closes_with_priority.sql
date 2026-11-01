-- 一般枠の段階を、優先期間の並びと締切からの推定(`isGeneralPhase()`)ではなく
-- `regulations.closes_with_priority` の明示の設定で決める(#243)。
--
-- 移行は今の受付条件の保存であり、直すことではない。推定で実際に枠が外れて
-- いる大会の、外れている枠にだけ true を立てる。北陸(一般枠の期間が締切前に
-- 終わる)や九州(一般枠に期間が無い)のように、今は外れていない大会はそのまま
-- にする。それを変えるのはスタッフの設定である。
--
-- デプロイではこのマイグレーションが Worker より先に走る。古い Worker はこの
-- 列を読まず、今までどおり優先期間から推定する。そのため優先期間は書き換えない。
-- 一般枠の優先期間を消すと、古い Worker の推定がその時点で変わってしまう。
alter table regulations
  add column closes_with_priority boolean not null default false;

-- `isGeneralPhase()` は `now` を受け取るが、結果は時刻に依存しない形で書ける。
-- 窓 i の開始・終了を s(i)・e(i)、受付開始・締切を O・C として
--
--   R = 締切に届く窓       { i | e(i) >= C - 60秒 }
--   F = 外れる候補の窓     { i | e(i) <  C - 60秒 かつ e(i) > O }
--
-- とすると、推定が真になるのは次の両方を満たすときだけである。
--
--   (1) R が空でなく、R のすべての窓 i に、e(j) <= s(i) である F の窓 j がある
--   (2) now >= すべての窓の開始 かつ now > F のすべての窓の終了
--
-- (2) が成り立てば F の窓はすべて `isFinishedPhase()` なので、外れる枠は常に
-- F そのものである。(1) は時刻を含まないので、大会ごとに一度だけ判定できる。
-- 外れる時刻そのもの (2) は `arePhasesOver()` が同じ式で計算する。この形を
-- 保つため、新しい判定も枠ごとの終了ではなく (2) の時点で外す。
--
-- 下の backfill の区切りのコメントは、統合テスト
-- (`apps/backend/src/lib/regulations-backfill.test.ts`)がこの文を切り出して
-- 実行するための目印である。
-- backfill:start
with windows as (
  select
    r.id,
    r.tournament_id,
    r.priority_starts_at as starts_at,
    r.priority_ends_at as ends_at,
    r.priority_ends_at >= t.entry_closes_at - interval '60 seconds'
      as reaches_close,
    r.priority_ends_at > t.entry_opens_at as ends_after_open
  from regulations r
  join tournaments t on t.id = r.tournament_id
  where r.priority_starts_at is not null
    and r.priority_ends_at is not null
),
earlier_phases as (
  select * from windows where not reaches_close and ends_after_open
)
update regulations r
set closes_with_priority = true
from earlier_phases e
where r.id = e.id
  and exists (
    select 1 from windows w
    where w.tournament_id = e.tournament_id and w.reaches_close
  )
  and not exists (
    select 1 from windows w
    where w.tournament_id = e.tournament_id
      and w.reaches_close
      and not exists (
        select 1 from earlier_phases p
        where p.tournament_id = w.tournament_id and p.ends_at <= w.starts_at
      )
  );
-- backfill:end

-- 保存に `closesWithPriority` が無ければ、今の値を保つ。古い Worker・開いた
-- ままの古い画面・列の無いスプレッドシートの空欄がこの形で届くので、false に
-- 読むとバックフィルを消してしまう。新しい行は false で始まる。優先期間が無い
-- 行には意味が無いので false にする。
--
-- `on conflict` より先に not null が検査されるので、既存の値は入力の時点で
-- 引いておく(`coalesce` を `do update` 側に書いても null の挿入で落ちる)。
-- 引数は変わらないので、古い Worker も `import_tournament()`(`0036`)も同じ形で
-- 呼べる。`import_tournament()` は要素に id を足して渡すだけなので、キーは
-- そのまま届く。それ以外は 0018 と同じである。
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
  perform 1 from tournaments where id = p_tournament_id for update;
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

revoke all on function sync_regulations(uuid, jsonb) from public;
grant execute on function sync_regulations(uuid, jsonb) to service_role;
