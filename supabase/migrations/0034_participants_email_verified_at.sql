-- 参加者アカウントがメールアドレスの持ち主に確かめられたかどうかを
-- `participants.email_verified_at` で持ち、確かめられていないアカウントを
-- 次のエントリーで作り直せるようにする(#189)。
--
-- 匿名エントリーは、確認メールのリンクが踏まれる前に、送信者が決めた
-- パスワードと大会の地域のまま `participants` 行を作る。参加者ログインは
-- 確認状態を見ておらず、その行を直す手段もなかったため、他人のアドレスで
-- 遠方の地域に先回りして登録すると、アドレスの持ち主は自分の地域で
-- 「別の地域で登録済み」として断られ、送信者は自分で決めたパスワードで
-- そのアカウントにログインできた。
--
-- この列が null のアカウント(未確認)は次のように扱う。
--
-- - 参加者ログインは、パスワードが合っていても資格情報の誤りと同じ応答で
--   断る(`routes/participant-auth.ts`)。発行済みのセッションも
--   `requireParticipant()` が断る。
-- - 匿名エントリーは、地域の検査をせず、送信されたパスワードと大会の地域で
--   アカウントを上書きする(`take_over_unverified_participant()`、下記)。
--   ただし、パスワードがアカウントのものと一致し、地域も同じなら、
--   アカウントを作った送信者自身の続きのエントリーなので、上書きせずに
--   そのまま受け付ける(確認前に同じ地域の 2 大会へ続けてエントリーしても、
--   先のエントリーが消えない)。
--
-- 確認済みになるのは、確認メールのリンクでエントリーを確定したときだけ
-- (`confirm_entry_by_token()`、下記)。リンクはそのアドレスにしか届かず、
-- そのリンクを発行したエントリーは、アカウントの今のパスワードと地域で
-- 送られたもの(上書きのたびに、それ以前のエントリーは消す。上書きと
-- 行き違いに書かれたエントリーは、アプリ側の `isStillUnverifiedAccountOf()`
-- が取り下げる)なので、
-- 確定した時点で「アドレスの持ち主が、このパスワードとこの地域を選んだ」
-- ことになる。
--
-- パスワードの再設定は、アドレスの持ち主であることは示すが、確認済みには
-- しない。再設定は地域を変えないので、未確認アカウントの地域は先回りした
-- 送信者が選んだもののままであり、ここで確認済みにすると、Issue の
-- 「再設定しても地域が戻らない」状態をそのまま確定させてしまう。未確認の
-- アドレスの持ち主は、再設定をしなくても、自分の地域の大会にエントリーし
-- 直せば(パスワードを問われずに)アカウントを取り戻せる。
--
-- 既存行の埋め戻しは、確認リンクで確定したことのあるエントリー
-- (`entries.email_verified_at` が null でない行)を持つ参加者だけを、その
-- 最も早い時刻で確認済みにする。過去にパスワードを再設定した参加者は、
-- 上と同じ理由で確認済みにしない(しかも使用済みの再設定トークンは
-- `requestPasswordReset()` が期限切れの行として削除するので、再設定した
-- かどうかを確実には辿れない)。確定したエントリーを持たない参加者は、
-- 適用後はログインできなくなり、そのセッションも切れる。そうした参加者は
-- 確定したエントリーを持っていないので、マイページで失うものは確定待ちの
-- エントリーだけで、確認メールのリンクを踏むか、エントリーし直せば戻れる。
--
-- ただし `entries.email_verified_at` は確定の記録として完全ではない。
-- キャンセルした大会へエントリーし直すと、`enterTournament()` はその行を
-- 再利用して `email_verified_at` を null に戻すので、確定 → キャンセル →
-- 再エントリーした参加者は、確定した痕跡を行ごと失っている。そうした参加者を
-- 未確認にすると、ログインできなくなるだけでなく、誰かがそのアドレスで
-- 別のパスワードや地域のエントリーを送るだけで `take_over_unverified_participant()`
-- にアカウントを奪われ、本人の再エントリーも消される。そこで、再利用された行を
-- 持つ参加者も確認済みにする。再利用されたかどうかは、行の作成時刻
-- (`entries.created_at`、最初のエントリーの時刻のまま)と、その行の確認トークンの
-- 期限(発行時刻 + 24 時間、`entry-verification.ts` の `TOKEN_TTL_MS`)の差で
-- 見分ける。新しく作った行は作成の直後にトークンを書くので差は 24 時間と数秒に
-- 収まり、再利用した行は再エントリーの時刻からの 24 時間になる。再利用された行の
-- 中には、確定しないままキャンセルされた(確定待ちのまま本人がキャンセルした、
-- または期限切れで取り消された)ものも混ざるが、それを見分ける記録は残って
-- いない。その参加者を確認済みにしても、この変更より前の扱いに留まるだけ
-- なのに対し、確定したことのある参加者を未確認にすると上のようにアカウントを
-- 失い得るので、確認済みの側に倒す。時刻は確定した時刻が残っていないため、
-- それより前であることだけは確かな行の作成時刻で代える。
alter table participants add column email_verified_at timestamptz;

update participants p
  set email_verified_at = verified.first_verified_at
  from (
    select evidence.participant_id, min(evidence.at) as first_verified_at
      from (
        select e.participant_id, e.email_verified_at as at
          from entries e
          where e.email_verified_at is not null
        union all
        select e.participant_id, e.created_at as at
          from entries e
          join email_verification_tokens evt on evt.entry_id = e.id
          where evt.expires_at > e.created_at + interval '25 hours'
      ) evidence
      group by evidence.participant_id
  ) verified
  where p.id = verified.participant_id;

-- 確定と同時に参加者を確認済みにする。`0008` からの変更は、参加者行の
-- ロックを最初に取ることと、最後の UPDATE だけ。
--
-- ロック順は「参加者行 → トークン行 → 大会行」になる。参加者行を後から
-- (大会行を持ったまま)取ると、`check_region_dual_entry()`(0017)が
-- 「参加者行 → 大会行(外部キー検査の key share)」の順で取るのと逆になって
-- デッドロックし得るため、先に取る。`take_over_unverified_participant()` も
-- 同じ順で取るので、確定と上書きは参加者行で直列化され、どちらが先でも
-- 矛盾しない(確定が先なら上書きは確認済みとして断られ、上書きが先なら
-- 確定しようとしたトークンは消えている)。`for no key update` にするのは、
-- エントリーの INSERT が外部キー検査で参加者行に取る `for key share` と
-- 衝突させないため。`cancel_own_entry()` と `lapse_expired_pending_entries()`
-- は参加者行を取らないので、「トークン行 → 大会行」の順のまま食い違わない。
create or replace function confirm_entry_by_token(p_token_hash text)
returns entry_status
language plpgsql
as $$
declare
  v_participant_id uuid;
  v_token_id uuid;
  v_entry_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
  v_tournament_id uuid;
  v_entry_status entry_status;
  v_capacity integer;
  v_confirmed_count bigint;
  v_waitlisted_count bigint;
  v_status entry_status;
  v_waitlist_position integer;
begin
  -- Unlocked, only to learn which participant row to lock first. Nothing is
  -- decided on it: the token is read again under its own lock below.
  select e.participant_id into v_participant_id
    from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where evt.token_hash = p_token_hash;

  if v_participant_id is null then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  perform 1 from participants p
    where p.id = v_participant_id
    for no key update;

  -- The token may have been burnt, or its entry deleted by
  -- `take_over_unverified_participant()`, while the participant lock was
  -- being waited for; both read as an unknown or used token here.
  select evt.id, evt.entry_id, evt.expires_at, evt.used_at, e.tournament_id
    into v_token_id, v_entry_id, v_expires_at, v_used_at, v_tournament_id
    from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where evt.token_hash = p_token_hash
    for update of evt;

  if v_token_id is null or v_used_at is not null or v_expires_at < now() then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  select capacity into v_capacity
    from tournaments where id = v_tournament_id for update;

  -- Re-read under the lock: a concurrent cancellation may have moved the
  -- entry since the token lookup above.
  select e.status into v_entry_status from entries e where e.id = v_entry_id;

  if v_entry_status <> 'pending_verification' then
    raise exception 'entry is not awaiting verification'
      using errcode = 'P0003';
  end if;

  select count(*) into v_confirmed_count
    from entries
    where tournament_id = v_tournament_id and status = 'confirmed';

  if v_capacity is not null and v_confirmed_count >= v_capacity then
    v_status := 'waitlisted';
    select count(*) into v_waitlisted_count
      from entries
      where tournament_id = v_tournament_id and status = 'waitlisted';
    v_waitlist_position := v_waitlisted_count + 1;
  else
    v_status := 'confirmed';
    v_waitlist_position := null;
  end if;

  update entries
    set status = v_status,
        email_verified_at = now(),
        waitlist_position = v_waitlist_position
    where id = v_entry_id;

  update email_verification_tokens
    set used_at = now()
    where id = v_token_id;

  -- The first confirmation is what proves the address; later ones leave the
  -- original time alone.
  update participants
    set email_verified_at = now()
    where id = v_participant_id and email_verified_at is null;

  return v_status;
end;
$$;

revoke all on function confirm_entry_by_token(text) from public;
grant execute on function confirm_entry_by_token(text) to service_role;

-- 未確認の参加者アカウントを、新しい匿名エントリーの送信者のものとして
-- 作り直す。パスワード(アプリ側で計算済みの PBKDF2 ハッシュ)と地域を
-- 上書きし、`password_changed_at` を進めて、それ以前に発行された
-- セッションも切る(未確認のアカウントには `requireParticipant()` がどのみち
-- セッションを認めないが、確認済みになった後まで古いセッションが生き残らない
-- ようにする)。
--
-- それまでの送信者が作ったエントリー(確定待ちと、期限切れで取り消された
-- もの)と、その確認トークンは削除する。キャンセル扱いで残さないのは次の理由。
--
-- - 確定待ちを残すと、そのリンク(アドレスの持ち主に届いている)を踏んだ時点で
--   アカウントが確認済みになるが、そのときのパスワードと地域は上書き後のもの、
--   つまりリンクを発行したのとは別の送信のものになる。先回りした送信者が
--   持ち主の送信の直後に上書きし、持ち主が自分のリンクを踏むと、先回りした
--   送信者のパスワードと地域で確認済みになってしまう。
-- - 取り消し済みとして残すと、先回りした送信者が書いた氏名や表示名が、
--   持ち主のマイページの履歴と、別の地域のスタッフのエントリー一覧に残り続ける。
-- - 両方に出られない地域でもう一方の大会の枠を持っていると、持ち主の
--   エントリーが `check_region_dual_entry()`(0017)に断られる。
--
-- どれも確認されたことのないエントリーで、定員(`confirmed` の数)にも
-- キャンセル待ちの順位にも関わらないので、消しても繰り上げ等は要らない。
--
-- 確認済みのアカウント(確定したエントリーを持つものを含む)は触らずに false を
-- 返す。呼び出し側はそのまま、パスワードを照合する今までの経路に進む。参加者行を
-- `for no key update` で取った後に条件を評価するので、同時に走った確定が先に
-- コミットしていれば、確認済みとして断られる(ロック順は
-- `confirm_entry_by_token()` の説明を参照)。トークン行のロックは
-- `lapse_expired_pending_entries()`(0030)と同じ大会 id 順に取り、同じ参加者に
-- 対する同時の呼び出しとデッドロックしないようにする。
create function take_over_unverified_participant(
  p_participant_id uuid,
  p_password_hash text,
  p_region_id uuid
)
returns boolean
language plpgsql
as $$
begin
  perform 1 from participants p
    where p.id = p_participant_id
      and p.email_verified_at is null
      -- Belt and braces: an entry only ever gets `email_verified_at` from
      -- `confirm_entry_by_token()`, which verifies the participant in the
      -- same transaction, so this only matters for a row the backfill above
      -- missed.
      and not exists (
        select 1 from entries e
          where e.participant_id = p.id and e.email_verified_at is not null
      )
    for no key update;

  if not found then
    return false;
  end if;

  update participants
    set password_hash = p_password_hash,
        region_id = p_region_id,
        password_changed_at = now()
    where id = p_participant_id;

  perform 1 from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where e.participant_id = p_participant_id
    order by e.tournament_id, e.id, evt.id
    for update of evt;

  delete from email_verification_tokens evt
    using entries e
    where e.id = evt.entry_id and e.participant_id = p_participant_id;

  -- `entry_regulations` goes with each row (`on delete cascade`, 0018).
  delete from entries e where e.participant_id = p_participant_id;

  return true;
end;
$$;

revoke all on function take_over_unverified_participant(uuid, text, uuid)
  from public;
grant execute on function take_over_unverified_participant(uuid, text, uuid)
  to service_role;
