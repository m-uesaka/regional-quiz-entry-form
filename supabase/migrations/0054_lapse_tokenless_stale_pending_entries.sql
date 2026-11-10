-- 確認トークンが 1 つも無いまま放置された確定待ちエントリーも
-- `lapse_expired_pending_entries()`(0030)で取り消す(#290)。
--
-- 0030 は「トークンが 1 つも無い」確定待ちを、同じ参加者の別の送信がちょうど
-- 行を書き込み、まだトークンを書いていないものとして触らなかった。確認メールの
-- 送信(またはトークンの書き込み)に失敗した行は `rollbackEntry()` が消すか元に
-- 戻すので、トークン無しのまま残ることはないという前提だった。しかし巻き戻しは
-- REST の別々の文で、その削除も一時障害で失敗しうる。そうなると確認リンクの
-- 届いていない `pending_verification` が残り、トークンが無いので失効もされず、
-- 再エントリーは `ENTRY_PENDING_VERIFICATION`(届いていない確認メールのリンクを
-- 開くよう案内される)で断られ続け、両方に出られない地域ではもう一方の大会の
-- エントリーも断られていた。
--
-- そこで、トークンが 1 つも無くても、行が最後に書き込まれてから(`updated_at`)
-- 確認リンクの有効期限(24 時間、`ENTRY_VERIFICATION_TOKEN_TTL_MS`)を過ぎて
-- いれば、期限切れのリンクしか無いエントリーと同じく取り消す。書き込み中の行を
-- 守るには送信 1 回にかかる時間より長ければ足りるので、この値が TTL と一致して
-- いる必要はない。TTL と揃えているのは、リンクが届いていれば期限が切れていた
-- 頃合いで扱いを揃えるため。
--
-- `created_at` でなく `updated_at` で測るのは、キャンセル済みの行を再利用する
-- 再エントリー(`reenter_cancelled_entry()`、0041)が、古い `created_at` のまま
-- トークンを消して行を書き直すため。`updated_at` はその UPDATE で
-- (`entries_set_updated_at`、0001)今の時刻になるので、書き込み中の再エントリーを
-- 取り消すことはない。
--
-- ロックの順(エントリーの確認トークン → 大会の行)、候補の大会 id 順、ロックの
-- 下での読み直しは 0030 と同じ。トークンが無い候補ではトークンのロックは何も
-- 取らないが、読み直しは大会のロックの下で行う。

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
        and (
          exists (
            select 1 from email_verification_tokens evt
              where evt.entry_id = e.id
          )
          or e.updated_at < now() - interval '24 hours'
        )
        and not exists (
          select 1 from email_verification_tokens evt
            where evt.entry_id = e.id
              and evt.used_at is null
              and evt.expires_at >= now()
        )
      order by e.tournament_id, e.id
  loop
    perform 1 from email_verification_tokens evt
      where evt.entry_id = v_entry.id
      for update;

    perform 1 from tournaments t where t.id = v_entry.tournament_id for update;

    -- Re-checked under the locks: the entry may have been confirmed or
    -- cancelled, rewritten by a re-entry, or given a fresh link, since the
    -- candidates were read.
    if exists (
      select 1 from entries e
        where e.id = v_entry.id
          and e.status = 'pending_verification'
          and (
            exists (
              select 1 from email_verification_tokens evt
                where evt.entry_id = e.id
            )
            or e.updated_at < now() - interval '24 hours'
          )
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
