-- 大会名を空欄にした大会の名前を、保存時ではなく読み出し時に作る(#164)。
--
-- 0023 までの API は、大会名が空欄のとき「地域名＋種別」(例: `東京最強位`)を
-- その場で作って `tournaments.name` に書き込んでいた。これだと、地域名を
-- 変えたり、大会名をそのままにして地域・種別を直したりしたときに、古い
-- 地域・種別の名前が残る。
--
-- `name` を null 可にし、null を「既定名を使う」とする。既定名は API が
-- 読むたびに今の地域名と種別から作る(`apps/backend/src/lib/tournaments.ts` の
-- `tournamentDisplayName()`)ので、どちらを変えても名前が追従する。
--
-- 既存の行のうち、今の地域・種別の既定名とまったく同じ名前のもの(と空文字の
-- もの)は null に置き換える。表示される名前は変わらない。種別のラベルは
-- `packages/shared/src/schemas/tournament.ts` の `TOURNAMENT_TYPE_LABELS` と
-- 同じ。

alter table tournaments alter column name drop not null;

update tournaments t
set name = null
from regions r
where r.id = t.region_id
  and (
    btrim(t.name) = ''
    or t.name = r.name || case t.type
      when 'saikyoi' then '最強位'
      when 'shinjinou' then '新人王'
    end
  );
