-- 大会の受付期間の前後関係と定員を DB 側でも検査する(#285)。
--
-- これまで「エントリー開始 < エントリー終了」を検査していたのは一括登録
-- (`lib/tournament-bulk-import.ts`)だけで、管理画面からの作成・更新
-- (`POST` / `PATCH /api/tournaments`)は通していた。終了が開始以前の大会は
-- `entryAvailability()` が一度も open にならず、誰もエントリーできないのに
-- スタッフは気付けない。`PATCH` は部分更新なので、片方だけを送られると
-- Zod スキーマ(`TournamentUpdateInputSchema`)では保存済みのもう片方と
-- 比べられない。そこで `regulations` の優先期間(0014)と同じく、SQL で
-- 直接編集する運用も含めて DB 側に CHECK を持つ。
--
-- - `tournaments_entry_period_ordered`: 開始が終了より厳密に前。開始と
--   終了が同じ時刻の期間も一度も open にならないので断る。
-- - `tournaments_capacity_positive`: 定員は null(定員なし)か 1 以上。0 以下
--   だと全員がキャンセル待ちになるか、`promote_waitlisted_entries()`(0037)
--   の空き数が負になる。API の Zod スキーマ(`.positive()`)と一括登録は
--   すでに 1 以上しか通さないので、これは SQL での直接編集に対する備え。
--
-- 違反した書き込みは `check_violation`(23514)になり、API は
-- `TOURNAMENT_WRITE_ERRORS`(`routes/tournaments.ts`)で 400 と
-- `ENTRY_PERIOD_ORDER_MESSAGE`(`packages/shared`)に対応付ける。
--
-- 既存の行の扱い: 違反する行があれば、このマイグレーションは理由と該当する
-- 大会の id を示す例外で止まる(ファイル全体が 1 トランザクションなので、
-- 何も適用されない)。違反した行を勝手に直すことはしない。受付期間や定員を
-- どう直すべきかは大会ごとにスタッフが決めることで、`regulations` の優先
-- 期間(0014)のように「無かったことにしても振る舞いが変わらない」値への
-- 置き換えがないため。`not valid` で既存の行を見逃すこともしない(新しい
-- 書き込みだけを検査すると、違反した大会が残っていることに誰も気付かない)。
--
-- **本番に適用する前に**、次のクエリで違反する行がないことを確認し、
-- あれば管理画面か SQL で直してから適用すること:
--
--   select id, region_id, type, capacity, entry_opens_at, entry_closes_at
--     from tournaments
--     where entry_opens_at >= entry_closes_at
--        or capacity <= 0;
do $$
declare
  v_bad_periods text;
  v_bad_capacities text;
begin
  select string_agg(id::text, ', ' order by id) into v_bad_periods
    from tournaments
    where entry_opens_at >= entry_closes_at;
  select string_agg(id::text, ', ' order by id) into v_bad_capacities
    from tournaments
    where capacity <= 0;

  if v_bad_periods is not null or v_bad_capacities is not null then
    raise exception 'tournaments violate the checks 0048 adds; fix them first'
      using detail = format(
        'entry_opens_at >= entry_closes_at: %s; capacity <= 0: %s',
        coalesce(v_bad_periods, 'none'),
        coalesce(v_bad_capacities, 'none')
      );
  end if;
end;
$$;

alter table tournaments
  add constraint tournaments_entry_period_ordered
    check (entry_opens_at < entry_closes_at),
  add constraint tournaments_capacity_positive
    check (capacity is null or capacity > 0);
