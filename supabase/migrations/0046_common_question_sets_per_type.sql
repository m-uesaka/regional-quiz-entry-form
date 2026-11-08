-- 共通問題(`question_set` が null)を、最強位用と新人王用で別の問題セットと
-- して扱う。
--
-- 0043 は null をすべて 1 つの問題セットとして比べていたので、地域 A の
-- 最強位(共通問題)と地域 B の新人王(共通問題)も同じ問題セットとして
-- 断っていた。最強位と新人王は基本的に問題を共通にしないので、共通問題は
-- 種別ごとに別物であり、この組み合わせは地域をまたいでもエントリーできる。
-- 0045 も null どうしを同じとは扱っておらず、それと揃う。
--
-- 名前を設定した問題セットは今までどおり名前だけで比べる。最強位と新人王に
-- 同じ名前を付ければ、同じ問題を使うものとして断る。
--
-- 呼び出し側(`check_entry_seat()`、`claim_participant_region_for_tournament()`、
-- `createEntryAfterCheck()`)はこの関数を呼ぶだけなので、置き換えるのは
-- この関数だけでよい。断る範囲が狭まるだけなので、デプロイ中の古い Worker
-- との組み合わせでも検査のない隙間はできない。
create or replace function participant_holds_conflicting_region(
  p_participant_id uuid,
  p_tournament_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from tournaments target
      join entries e on e.participant_id = p_participant_id
      join tournaments t on t.id = e.tournament_id
      where target.id = p_tournament_id
        and t.region_id <> target.region_id
        and (
          t.question_set = target.question_set
          or (
            t.question_set is null
            and target.question_set is null
            and t.type = target.type
          )
        )
        and (
          e.status <> 'cancelled'
          or (
            e.email_verified_at is not null
            and e.cancelled_at > t.entry_closes_at
          )
        )
  );
$$;
