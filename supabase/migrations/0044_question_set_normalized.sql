-- 問題セット名を、保存する時点で 1 つの表記に揃える(#271 のレビュー)。
--
-- 問題セットは名前の完全一致で比べる(`participant_holds_conflicting_region()`)
-- ので、見た目が同じでも表記が違えば別の問題セットになり、断るべき地域を
-- またいだエントリーが通ってしまう。管理画面の入力(`QuestionSetInputSchema`)は
-- 書式文字(ゼロ幅スペースなど)を取り除き、NFKC 正規化(全角英数字を半角に)
-- してから保存するが、0043 の制約はそれを求めていなかった。SQL で入れた
-- 「宮崎Ａ」を画面で選ぶと「宮崎A」が保存されて別物になる、定員だけを
-- 直して保存しても問題セットが書き換わる、といったことが起きるので、
-- 揃っていない値を DB が拒否するようにする。保存される値がいつも揃った
-- 形なら、画面がそれを送り直しても同じ値のままになる。
--
-- 既存の値は先に揃える。0043 の制約で空白は入っていないので、揃えて空に
-- なるのは書式文字だけの名前で、それは共通問題(null)にする。
--
-- 書式文字の一覧は Unicode の Cf(Format)のうち、名前に紛れ込んで見えなく
-- なるもの。JavaScript 側は `\p{Cf}` 全体を取り除くので、こちらはその部分
-- 集合で足りる(画面を通った値は必ずここを通る)。
update tournaments
  set question_set = nullif(
    normalize(
      regexp_replace(
        question_set,
        '[­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]',
        '',
        'g'
      ),
      nfkc
    ),
    ''
  )
  where question_set is not null;

alter table tournaments
  drop constraint tournaments_question_set_format,
  add constraint tournaments_question_set_format check (
    question_set is null
    or (
      char_length(question_set) between 1 and 100
      and question_set !~ '[[:space:]　]'
      and question_set !~ '[­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]'
      and question_set is nfkc normalized
    )
  );
