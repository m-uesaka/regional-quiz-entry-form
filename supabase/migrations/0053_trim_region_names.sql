-- 地域名とレギュレーション名の前後の空白を取り除く(#300)。
--
-- 地域の作成・更新(`RegionSchema`)は名前を trim していなかった。大会一覧
-- シートからの一括登録はセルを trim してから地域名の完全一致で引くので、
-- 「東京 」(末尾に空白)で登録した地域は「地域「東京」が登録されていません」で
-- 弾かれ、既定の大会名も「東京  最強位」になっていた。スキーマは今後 trim して
-- 保存するので、既存の行もここで揃える。
--
-- レギュレーション名もフォームからは trim していなかった(シートからの取り込みは
-- trim する)。名前で引く処理はないが、同じ規則に揃える。
--
-- 取り除く文字は JavaScript の `String.prototype.trim()` と同じ集合
-- (WhiteSpace と LineTerminator)。Postgres の `btrim()` は既定で半角空白しか
-- 取らず、`[[:space:]]` はロケールに依存するので、文字を並べて書く。全角空白
-- (U+3000)もこれに含まれる。
--
-- trim すると空になる行は変えない(地域名・レギュレーション名を空にはできない)。
-- そうした行があればスタッフが画面から直す。

update regions
  set name = regexp_replace(
    name,
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
    '',
    'g'
  )
  where name ~ '^[\t\n\v\f\r    -     　﻿]|[\t\n\v\f\r    -     　﻿]$'
    and name !~ '^[\t\n\v\f\r    -     　﻿]*$';

update regulations
  set label = regexp_replace(
    label,
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
    '',
    'g'
  )
  where label ~ '^[\t\n\v\f\r    -     　﻿]|[\t\n\v\f\r    -     　﻿]$'
    and label !~ '^[\t\n\v\f\r    -     　﻿]*$';
