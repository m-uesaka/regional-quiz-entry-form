-- 公開エントリーリスト(`GET /:tournamentId/entry-list` とその slug 版)の
-- 並び順を、フォームを送った時刻(`created_at`)からエントリーが確定した時刻
-- (`email_verified_at`、確認メールのリンクを踏んだ時刻)に変えたのに合わせた
-- インデックス。0005 の `(tournament_id, created_at)` と同じ考え方で、
-- エンドポイントが読む行(確定したことのある、未確認以外の行)だけに張る。
--
-- 0005 は残す: `(tournament_id, created_at)` は 0022 で `status` 単独の
-- インデックスを張らない根拠にもしており、`tournament_id` と `status` で
-- 絞る他のクエリが引き続き使う。
create index entries_tournament_id_email_verified_at_idx
  on entries (tournament_id, email_verified_at, id)
  where status in ('confirmed', 'waitlisted', 'cancelled')
    and email_verified_at is not null;
