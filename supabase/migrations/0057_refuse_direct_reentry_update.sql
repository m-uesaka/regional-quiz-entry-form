-- 再エントリーの直接の UPDATE を断り、ロック順をスキーマで保証する(#261)。
--
-- 0041 は再エントリーを `reenter_cancelled_entry()` に移し、「参加者行 →
-- `entries` 行」の順でロックするようにした。ただし 0041 の適用後しばらくは
-- 古い Worker が `entries` を直接 UPDATE していたので、`check_entry_seat()` は
-- `cancelled` の行を直接 UPDATE で戻す書き込みも検査して通していた。その
-- Worker はもう動いていない(#259 は本番に出ている)。
--
-- この経路が残っていると、今後のコードが `cancelled` の行を直接 UPDATE で
-- 戻したときに、「`entries` 行 → 参加者行」の順が静かに戻り、
-- `take_over_unverified_participant()`(参加者行 → `entries` 行)との
-- デッドロックが再発する。そこで、`cancelled` の行を `cancelled` 以外に
-- する UPDATE は、`reenter_cancelled_entry()` からのものだけを通し、それ以外は
-- `P0012` で断る。断るのは参加者行を取りに行く前なので、断られる UPDATE が
-- `entries` 行を持ったまま参加者行を待つこともない。
--
-- 関数経由かどうかは、トランザクションローカルの設定値
-- `app.reentering_entry_id` で見分ける。`reenter_cancelled_entry()` が参加者行を
-- 取った後、UPDATE の直前に `set_config(..., true)` で対象のエントリー ID を
-- 入れ、UPDATE の直後に空に戻す。トリガは、設定値が UPDATE される行の ID と
-- 一致するときだけ通す。
--
-- - 行の ID と突き合わせるので、関数が通すのは引数で渡された 1 行だけ。同じ
--   トランザクションの後続の文(関数を `begin` の中で呼ぶテストなど)には
--   持ち越されない。UPDATE が `P0005` / `P0008` で断られたときは例外で関数ごと
--   巻き戻るので、設定値も元に戻る(サブトランザクションで受けた場合も同じ)
-- - 設定値は誰でも `set_config()` で書けるので、SQL を直接流せる接続
--   (`postgres` ロール。SQL Editor やマイグレーション)からは偽装できる。
--   ただしその接続はトリガを外すこともできるので、ここで守る対象ではない。
--   この検査はセキュリティの境界ではなく、コードの書き間違いに対するガード
--   で、偽装しても地域と重複エントリーの検査(`P0008` / `P0005`)は同じ
--   トリガの続きでそのまま行われる。失うのはロック順の保証だけ
-- - Worker は PostgREST 経由(`service_role`)でしか書かない(0035 で `anon` /
--   `authenticated` の権限は外してある)。PostgREST は 1 リクエスト =
--   1 トランザクションで、呼べる関数は公開スキーマ(`public`)のものだけ。
--   `pg_catalog.set_config()` は呼べず、`public` に任意の設定値を書く関数も
--   ないので、テーブルへの UPDATE と同じトランザクションでこの設定値を
--   立てる手段がない。PostgREST 自身が立てる設定値は `request.*` と、サーバ側の
--   設定から来る `app.settings.*` だけで、この名前とは重ならない
--
-- `cancelled` から戻す経路がほかにないことは、適用前に確かめた。
--
-- - `confirm_entry_by_token()`(0047)は `pending_verification` の行だけを
--   確定する(それ以外は `P0003`)
-- - `promote_waitlisted_entries()`(0037)が更新するのは `waitlisted` の行だけ
-- - `cancel_own_entry()`(0006)、`lapse_expired_pending_entries()`(0054)は
--   `cancelled` にする向き。`take_over_unverified_participant()` と
--   `reset_tournament_entries()` は行を消す
-- - Worker の直接の UPDATE は 2 つ。`updateOwnEntry()` は `status` を書かず、
--   編集できるステータス(`cancelled` を含まない)の行に絞る。`rollbackEntry()`
--   は失敗した再エントリーの行を `cancelled` に戻す向きで、枠を取らないので
--   これまでどおりトリガの先頭で素通りする
-- - スタッフの操作に、エントリーのステータスを書き換えるものはない
--
-- デプロイの順序: マイグレーションは Worker より先に走るが、今の Worker は
-- 既に `reenter_cancelled_entry()` を同じシグネチャで呼んでいる。関数は
-- `create or replace` で、引数も戻り値も 0052 のまま(0041 の `revoke` /
-- `grant` も残る)なので、Worker の入れ替えの前後どちらでも動く。
--
-- ロック順(0041 / 0050 の表)は変わらない。変わるのは、表の
-- 「`reenter_cancelled_entry()`: P → Tk → E → T」が、呼び出し側の規律ではなく
-- スキーマで守られるようになること。`cancelled` の行を戻す書き込みは、必ず
-- 参加者行を先に取っている。
--
-- `P0012` は `lib/pg-errors.ts` の `DIRECT_REENTRY_SQLSTATE`。Worker からは
-- 起きない経路なので、利用者向けのエラーコードには対応付けず、予期しない
-- 失敗(500)として扱う。

-- 0050 の本体に、関数を通らない再エントリーを断る 1 段を足したもの。それ以外
-- (ロック、検査の順、errcode)は変えない。
create or replace function check_entry_seat()
returns trigger
language plpgsql
as $$
declare
  v_tournament_region_id uuid;
  v_allows_dual_entry boolean;
begin
  -- Only a write *taking* a seat is checked: see 0041.
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelled' then
    return new;
  end if;

  -- A cancelled row is taken back only by `reenter_cancelled_entry()`
  -- (0057, #261), which holds the participant row before this update locked
  -- the entry's. Any other update got here holding the entry row first --
  -- the order `take_over_unverified_participant()` deadlocks against -- so it
  -- is refused, and before the participant lock below so it never waits on
  -- it. The function names the one row it is about to update in a
  -- transaction-local setting; `current_setting(..., true)` is null where
  -- it was never set.
  if tg_op = 'UPDATE'
    and current_setting('app.reentering_entry_id', true)
      is distinct from old.id::text
  then
    raise exception
      'a cancelled entry is re-entered only through reenter_cancelled_entry()'
      using errcode = 'P0012';
  end if;

  -- The participant is the contended resource: every check below runs under
  -- this lock, which is what serializes it with a concurrent submission's
  -- write and with `claim_participant_region_for_tournament()`.
  perform 1
    from participants p
    where p.id = new.participant_id
    for no key update;

  -- The tournament's region and type are read under this lock (0050, #284):
  -- a move of the tournament holds the row `for update` until it commits,
  -- and the statements after this one see where it moved to. Taken after
  -- the participant, the order the foreign key check already takes them in.
  perform 1
    from tournaments t
    where t.id = new.tournament_id
    for key share;

  select t.region_id, r.allows_dual_entry
    into v_tournament_region_id, v_allows_dual_entry
    from tournaments t
    join regions r on r.id = t.region_id
    where t.id = new.tournament_id;

  -- A statement of its own after the lock, so it sees what a concurrent
  -- submission committed while this one waited.
  if participant_holds_conflicting_region(new.participant_id, new.tournament_id)
  then
    raise exception 'participant belongs to another region'
      using errcode = 'P0008';
  end if;

  if v_allows_dual_entry then
    return new;
  end if;

  if exists (
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      where e.participant_id = new.participant_id
        and t.region_id = v_tournament_region_id
        and e.tournament_id <> new.tournament_id
        and e.status <> 'cancelled'
  ) then
    raise exception 'already entered another tournament in this region'
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;

-- 0052 の本体に、UPDATE の前後で設定値を立てて戻す 2 文を足したもの。それ以外
-- (ロック、トークンの削除、上書きする列、0 行を返す条件)は変えない。
create or replace function reenter_cancelled_entry(
  p_entry_id uuid,
  p_participant_id uuid,
  p_name text,
  p_furigana text,
  p_display_name text,
  p_free_text text,
  p_custom_field_values jsonb
)
returns setof entries
language plpgsql
as $$
begin
  perform 1 from participants p
    where p.id = p_participant_id
    for no key update;

  delete from email_verification_tokens t
    using entries e
    where t.entry_id = p_entry_id
      and e.id = t.entry_id
      and e.participant_id = p_participant_id
      and e.status = 'cancelled'
      and (t.used_at is not null or t.expires_at < now());

  -- Tells `check_entry_seat()` that the update below comes from here, with
  -- the participant row already held (0057). Local to the transaction, and
  -- cleared right after the update so that it covers this one statement.
  perform set_config('app.reentering_entry_id', p_entry_id::text, true);

  return query
    update entries e
      set name = p_name,
          furigana = p_furigana,
          display_name = p_display_name,
          free_text = p_free_text,
          custom_field_values = p_custom_field_values,
          status = 'pending_verification',
          waitlist_position = null,
          email_verified_at = null,
          confirmed_at = null,
          cancelled_at = null
      where e.id = p_entry_id
        and e.participant_id = p_participant_id
        and e.status = 'cancelled'
      returning e.*;

  perform set_config('app.reentering_entry_id', '', true);
end;
$$;
