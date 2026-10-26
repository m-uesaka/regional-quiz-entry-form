-- 間違えて作った大会を統括スタッフが削除できるようにする(#164)。
--
-- `DELETE /api/tournaments/:id` は `tournaments` の行を 1 文で消す。大会に
-- ぶら下がるデータのうち、大会と一緒に消えてよいものだけを
-- `on delete cascade` にし、削除が 1 文・1 トランザクションで終わるようにする。
--
--   * `regulations` / `form_field_defs`: 大会の設定そのもの。大会が無ければ
--     意味を持たない。
--   * `mail_jobs`: 大会に送った一斉メールの記録。
--
-- `entries` は cascade にしない(no action のまま)。エントリーは参加者の
-- 個人情報であり、参加した記録でもあるので、大会の削除に巻き込んで消して
-- よいものではない。エントリーが 1 件でもある大会の削除は外部キー違反
-- (23503)で止まり、API はそれを 409 として返す。`entry_regulations` は
-- `regulations` を no action で参照しているが、行があるのはエントリーが
-- ある大会だけなので、先に `entries` の検査で止まる。

alter table regulations
  drop constraint regulations_tournament_id_fkey,
  add constraint regulations_tournament_id_fkey
    foreign key (tournament_id) references tournaments (id) on delete cascade;

alter table form_field_defs
  drop constraint form_field_defs_tournament_id_fkey,
  add constraint form_field_defs_tournament_id_fkey
    foreign key (tournament_id) references tournaments (id) on delete cascade;

alter table mail_jobs
  drop constraint mail_jobs_tournament_id_fkey,
  add constraint mail_jobs_tournament_id_fkey
    foreign key (tournament_id) references tournaments (id) on delete cascade;
