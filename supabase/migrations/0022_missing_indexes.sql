-- 外部キーの子側などで抜けていたインデックスを張る(Task 12-4 / #126)。
--
-- これまでに張ってあるのは、主キーと unique 制約が作る分のほかに
-- `entries (tournament_id, created_at)`(0005)、
-- `password_reset_tokens (participant_id)`(0012)、
-- `regulations (tournament_id, display_order)`(0014)、
-- `staff_password_reset_tokens (staff_account_id)`(0015)、
-- `entry_regulations (regulation_id)`(0018)、
-- `mail_jobs (tournament_id, created_at)`(0019)。
--
-- ロックについて: 素の `create index` は作成中、対象テーブルに SHARE ロックを
-- 取り、その間の insert / update / delete を待たせる。`concurrently` なら
-- 書き込みを止めずに済むが、トランザクション内では実行できず、Supabase の
-- マイグレーションはファイルごとにトランザクションで流れるため使えない。
-- 3 テーブルとも行数は小さい(エントリー数・参加者数・スタッフ数の規模)ので、
-- ロックはすぐ外れる。

-- メール送信に失敗したエントリーのロールバック(`lib/entries.ts` の
-- `rollbackEntry()`)と、キャンセル時のトークン焼却
-- (0006_cancel_own_entry_fn.sql の `cancel_own_entry()`)が `entry_id` で引く。
-- ロールバックで `entries` の行を消すときの外部キー検査もこの列を引く。
-- このテーブルには主キーと `token_hash` の unique 制約しか無かった。
create index email_verification_tokens_entry_id_idx
  on email_verification_tokens (entry_id);

-- 外部キーの子側。参照元から引く用途は現状無いが、親行の削除・更新のたびに
-- Postgres がこの列をスキャンする。地域を消す運用は無い(Task 9-2)ので
-- 優先度は低い。コストが小さいので併せて張っておく。
create index participants_region_id_idx on participants (region_id);
create index staff_accounts_region_id_idx on staff_accounts (region_id);

-- 張らないもの:
--
-- - `regulations (tournament_id)`: 0014_sync_regulations_fn.sql(Task 9-1)の
--   `regulations_tournament_id_display_order_idx`
--   (`(tournament_id, display_order)`)が先頭列に持つため不要。
-- - `entries (participant_id)`: 0001 の `unique (participant_id, tournament_id)`
--   が先頭列に持つため、マイページの一覧はこれで引ける。
-- - `form_field_defs (tournament_id)`: 0001 の
--   `unique (tournament_id, field_key)` が先頭列に持つため不要。
-- - `entries (status)`: 4 値しかなく単独では選択度が低い。実際のクエリは
--   必ず `tournament_id` と併用されるので、0005 の
--   `(tournament_id, created_at)` で足りる。

-- 計測(ローカル Supabase、2026-10-24):
--
-- 実データ規模ではプランナーが Seq Scan を選ぶため、1 トランザクション内で
-- regulations 10,000 行(200 大会 × 50 件)、email_verification_tokens
-- 10,000 行を投入して `analyze` した上で `explain analyze` を取り、最後に
-- rollback した。`enable_seqscan` は変更していない。結果(抜粋):
--
-- select * from regulations where tournament_id = $1 order by display_order
--   Sort (actual rows=50)
--     ->  Bitmap Heap Scan on regulations (actual rows=50)
--           ->  Bitmap Index Scan on regulations_tournament_id_display_order_idx
--                 Index Cond: (tournament_id = '...'::uuid)
--   Execution Time: 0.052 ms
--
-- delete from email_verification_tokens where entry_id = $1
--   Delete on email_verification_tokens
--     ->  Index Scan using email_verification_tokens_entry_id_idx
--           Index Cond: (entry_id = '...'::uuid)
--   Execution Time: 0.152 ms
--
-- 比較のため同じトランザクション内で email_verification_tokens_entry_id_idx を
-- drop して取り直すと `Seq Scan on email_verification_tokens`
-- (Rows Removed by Filter: 9999、Execution Time: 1.196 ms)になった。
