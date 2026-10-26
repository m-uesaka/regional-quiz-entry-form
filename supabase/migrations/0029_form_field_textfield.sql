-- 大会固有の設問に、一行の自由記述 `textfield` を加える(#173)。
--
-- これまで自由記述は複数行の `textarea` だけだったが、名前や所属のように
-- 一行で足りる設問にも複数行の入力欄が出ていた。`field_type` の check 制約
-- (0001 でインラインに付けたもの。名前は Postgres の既定の
-- `form_field_defs_field_type_check`)を張り替えて `textfield` を許す。
-- 回答の保存形式(`entries.custom_field_values` の文字列)は `textarea` と同じ。

alter table form_field_defs
  drop constraint form_field_defs_field_type_check;

alter table form_field_defs
  add constraint form_field_defs_field_type_check
  check (field_type in ('checkbox', 'radio', 'textarea', 'textfield'));
