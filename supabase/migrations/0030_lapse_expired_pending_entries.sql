-- 確認メールの期限が切れた確定待ちエントリーを取り消す `lapse_expired_pending_entries()`(#172)。
--
-- 確認リンク(24 時間)を開かないまま期限が切れると、エントリーは
-- `pending_verification` のまま残り、同じ大会への再エントリーを
-- `already entered` で断り、両方に出られない地域ではもう一方の大会への
-- エントリーも(`check_region_dual_entry()`、0017)断っていた。もう確定
-- できないエントリーが枠だけを占め続けていたことになる。
--
-- エントリーの処理(`enterTournament()`)はこの関数を最初に呼び、その参加者の
-- 確定待ちエントリーのうち、使える確認トークン(未使用かつ期限内)が 1 つも
-- 残っていないものを `cancelled` にする。以後は参加者がキャンセルした
-- エントリーと同じ扱いになり、同じ大会なら行が再利用され(新しい確認メールが
-- 届く)、もう一方の大会の枠も空く。期限内のリンクが残っているエントリーは
-- 触らない(今までどおり再エントリーを断る)。
--
-- ロックは `confirm_entry_by_token()`(0008)・`cancel_own_entry()`(0006)と
-- 同じ順(エントリーの確認トークン → 大会の行)で取り、状態とトークンは
-- 大会のロックの下で読み直す。確認と同時に走っても、確認が先なら
-- `pending_verification` でなくなっているので触らず、こちらが先なら確認は
-- 期限切れのトークンとして断られる。複数のエントリーは id 順に処理し、
-- 同じ参加者の 2 つの呼び出しが互いを待たないようにする。
--
-- 取り消したエントリーの id を返す。
create or replace function lapse_expired_pending_entries(
  p_participant_id uuid
)
returns setof uuid
language plpgsql
as $$
declare
  v_entry record;
begin
  for v_entry in
    select e.id, e.tournament_id
      from entries e
      where e.participant_id = p_participant_id
        and e.status = 'pending_verification'
      order by e.id
  loop
    perform 1 from email_verification_tokens evt
      where evt.entry_id = v_entry.id
      for update;

    perform 1 from tournaments t where t.id = v_entry.tournament_id for update;

    if exists (
      select 1 from entries e
        where e.id = v_entry.id and e.status = 'pending_verification'
    ) and not exists (
      select 1 from email_verification_tokens evt
        where evt.entry_id = v_entry.id
          and evt.used_at is null
          and evt.expires_at >= now()
    ) then
      update entries
        set status = 'cancelled',
            cancelled_at = now(),
            waitlist_position = null
        where id = v_entry.id;

      update email_verification_tokens
        set used_at = now()
        where entry_id = v_entry.id and used_at is null;

      return next v_entry.id;
    end if;
  end loop;
end;
$$;

revoke all on function lapse_expired_pending_entries(uuid) from public;
grant execute on function lapse_expired_pending_entries(uuid) to service_role;
