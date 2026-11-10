-- 旧来の一般枠の優先期間を消す(#262)。
--
-- #243(`0042`)より前の大会は、一般枠のレギュレーションに「優先枠が終わって
-- から締切まで」の優先期間を置いて一般枠の段階を表していた。`0042` はその
-- 期間を消せなかった(古い Worker が推定に使うため)ので、Worker は
-- `followsClosingPhase()` で「`外す` の枠が終わった後に始まった、`外す` の
-- 付かない優先期間」を制限から除いてきた。古い Worker はもう動いておらず、
-- この特例を消す。消した後は、`外す` の付かない優先期間は書いたとおり期間中の
-- 制限になるので、その前に特例に頼っている期間を消しておく。
--
-- 消すのは「消しても、この先の受付条件が変わらない」と SQL だけで言える期間に
-- 限る。窓の開始・終了を s・e、適用時刻を M として、次をすべて満たす窓である。
--
--   (1) `外す` が付いていない
--   (2) 同じ大会に、e(c) <= s である `外す` の窓 c がある(特例の対象)
--   (3) e < M(もう終わっている)、または、同じ大会の `外す` の窓がすべて
--       M より前に終わり、どの窓も M までに始まっている(`arePhasesOver()` が
--       M 以降ずっと真)
--
-- 変わらない理由:
--   * (3) のどちらでも s <= M で、窓はもう始まっている。`arePhasesOver()` は
--     「すべての窓が始まった」を条件に含むので、まだ始まっていない窓を消すと
--     枠が外れる時刻が早まり、優先枠の終了から一般枠の開始までの間、今は
--     選べている優先枠が選べなくなる(北海道の形)。始まった窓なら、消しても
--     M 以降の `arePhasesOver()` は変わらない。
--   * (3) の前半なら、窓は M 以降に開かない。後半なら、窓が開いている間は
--     ずっと `arePhasesOver()` が真なので、特例がこの窓を制限から除いている。
--     どちらでも、M 以降にこの窓が制限になることは今も無い。
--   * `外す` の窓は書き換えないので、選択肢から外れる枠は変わらない。
--
-- したがって、この更新の前後で、特例を持つ Worker の判定は変わらない
-- (マイグレーションは Worker より先に出る)。特例を消した Worker との差は、
-- ここで消さなかった (1)(2) の窓にだけ出る。まだ始まっていない窓と、開いては
-- いるが `外す` の枠かこれから始まる窓がまだ残っている大会の窓で、これらは
-- 書いたとおりの制限になる。
-- 適用前に `docs/supabase-deployment.md` 5.3 の SQL で一覧を確かめること。
--
-- M は 1 分手前に取る。Worker の時計が DB より遅れていても、境界がちょうど
-- 適用時刻に重なった窓を取り違えないためである。
--
-- 下の prune の区切りのコメントは、統合テスト
-- (`apps/backend/src/lib/regulations-backfill.test.ts`)がこの文を切り出して
-- 実行するための目印である。

-- レギュレーションの保存(`sync_regulations()`、`0058`)と同じロックを取り、
-- 集計と更新の間に窓を書き換えられないようにする。`外す` の窓がある大会だけで
-- 足りる。
select t.id
from tournaments t
where exists (
  select 1 from regulations r
  where r.tournament_id = t.id
    and r.closes_with_priority
    and r.priority_starts_at is not null
    and r.priority_ends_at is not null
)
order by t.id
for no key update;

-- prune:start
update regulations r
set priority_starts_at = null,
  priority_ends_at = null
from (
  select
    tournament_id,
    min(priority_ends_at) filter (where closes_with_priority)
      as first_closing_end,
    max(priority_ends_at) filter (where closes_with_priority)
      as last_closing_end,
    max(priority_starts_at) as last_start
  from regulations
  where priority_starts_at is not null
    and priority_ends_at is not null
  group by tournament_id
) p
where p.tournament_id = r.tournament_id
  and not r.closes_with_priority
  and r.priority_starts_at is not null
  and r.priority_ends_at is not null
  and p.first_closing_end <= r.priority_starts_at
  and (
    r.priority_ends_at < now() - interval '1 minute'
    or (
      p.last_closing_end < now() - interval '1 minute'
      and p.last_start <= now() - interval '1 minute'
    )
  );
-- prune:end
