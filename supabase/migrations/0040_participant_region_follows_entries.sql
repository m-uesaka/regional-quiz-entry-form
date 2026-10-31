-- 確認済みの参加者が、キャンセルの後に別の地域の大会へエントリーできるようにする
-- (#236)。
--
-- `participants.region_id` は最初のエントリーの地域のまま変わらなかったので、
-- エントリーをキャンセルしても別の地域の大会は「別の地域で登録済み」として
-- 断られ、大会を間違えた参加者には直す手段がなかった。守りたいのは
-- 「地域をまたいで参加しない」ことであり、参加中でない地域に縛ることではない。
--
-- そこで地域は、別の地域に次のエントリーが無ければ移せるものとする。
--
-- - 参加中のエントリー(`cancelled` 以外)
-- - その大会の受付終了より後にキャンセルした、確定済みだったエントリー
--
-- 後者を残すのは、キャンセルに期限が無いため。これを数えないと、ある地域の
-- 大会に出た後でキャンセルし、別の地域の大会に出られてしまう。救いたいのは
-- 大会を間違えた参加者なので、受付中のキャンセルは地域を押さえない。確定して
-- いないエントリーは、受付終了後に取り消されても(期限切れを含む)参加の
-- 見込みが無かったものなので数えない。
--
-- `claim_participant_region()` は、確認済みの参加者のエントリーの処理
-- (`enterTournament()`)がエントリーを書く前に呼び、移せたら(もともとその
-- 地域なら何もせずに)true を、上のエントリーがあれば false を返す。未確認の
-- アカウントの地域は作成時と上書き時に決まっているので呼ばない。期限切れの
-- 確定待ちが地域を押さえ続けないよう、呼び出し側は先に
-- `lapse_expired_pending_entries()`(0030)を呼ぶ。この関数の中で呼ばないのは、
-- 参加者行を持ったまま大会行を取ると、大会行の外部キー検査と順序が逆になる
-- ため(ロック順は 0034 の `confirm_entry_by_token()` の説明を参照)。参加者行は
-- 0034 と同じ理由で `for no key update` で取る。条件は 0034 と同じく、ロックを
-- 取った後の別の文で見るので、ロック待ちの間にコミットされたエントリーも
-- 見える。
--
-- 確認した後にエントリーを書くまでの間に、同じ参加者の別の送信が地域を移すと、
-- 古い地域にエントリーが書かれて地域をまたいでしまう。これを
-- `check_participant_region()` トリガが止める。参加者行を取ってから地域を
-- 読むので、`claim_participant_region()` とはこの行で直列化される。
-- エントリーが先なら移す側が参加中のエントリーを見て断り、移す側が先なら
-- エントリーが新しい地域を見て断る。検査するのは枠を取る書き込みだけで、
-- 条件もその理由も `check_region_dual_entry()`(0017)と同じ。
create function claim_participant_region(
  p_participant_id uuid,
  p_region_id uuid
)
returns boolean
language plpgsql
as $$
begin
  perform 1 from participants p
    where p.id = p_participant_id
    for no key update;

  if exists (
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      where e.participant_id = p_participant_id
        and t.region_id <> p_region_id
        and (
          e.status <> 'cancelled'
          or (
            e.email_verified_at is not null
            and e.cancelled_at > t.entry_closes_at
          )
        )
  ) then
    return false;
  end if;

  update participants
    set region_id = p_region_id
    where id = p_participant_id
      and region_id <> p_region_id;

  return true;
end;
$$;

revoke all on function claim_participant_region(uuid, uuid) from public;
grant execute on function claim_participant_region(uuid, uuid)
  to service_role;

create function check_participant_region()
returns trigger
language plpgsql
as $$
declare
  v_participant_region_id uuid;
  v_tournament_region_id uuid;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelled' then
    return new;
  end if;

  select p.region_id into v_participant_region_id
    from participants p
    where p.id = new.participant_id
    for update;

  select t.region_id into v_tournament_region_id
    from tournaments t
    where t.id = new.tournament_id;

  if v_participant_region_id <> v_tournament_region_id then
    raise exception 'participant belongs to another region'
      using errcode = 'P0008';
  end if;

  return new;
end;
$$;

create trigger entries_check_participant_region
  before insert or update on entries
  for each row
  execute function check_participant_region();
