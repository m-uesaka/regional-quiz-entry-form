-- エントリーの文字列項目に長さの上限を張る(Task 11-7 / #122)。
--
-- これまで上限が無く、1 リクエストで数 MB を保存でき、それが公開エントリー
-- リスト・スタッフ一覧・CSV にそのまま乗っていた。上限の本体は
-- `packages/shared` の Zod スキーマ(`EntryInputSchema` /
-- `CustomFieldValuesInputSchema`)にあり、ここではそれを DB 側でも持つ。
-- 直接 SQL でデータを入れる運用が当面残るため。
--
-- 値は Zod 側と同じ。ただし Zod は UTF-16 のコード単位で数え、
-- `char_length()` はコードポイントで数えるため、絵文字などのサロゲート
-- ペアでは DB の方がわずかに緩い。Zod を通った値が DB で弾かれることは
-- ない向きのずれなので、そのままにしている。

-- 追加項目の回答の合計文字数。オブジェクトの各値(文字列、または文字列の
-- 配列)の長さを足し合わせる。キーは数えない(Zod 側の
-- `customFieldValuesLength()` と同じ数え方)。
--
-- タスクの当初案は `pg_column_size(custom_field_values) <= 20000` だったが、
-- これは圧縮後のバイト数で、日本語(UTF-8 で 1 文字 3 バイト)の回答だと
-- Zod の上限(合計 10000 文字)以内でも超えることがあるため、文字数で
-- 数える関数にした。
create function custom_field_values_length(p_values jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(char_length(element)), 0)
  from jsonb_each(p_values) as field (key, value)
  cross join lateral jsonb_array_elements_text(
    case jsonb_typeof(field.value)
      when 'array' then field.value
      else jsonb_build_array(field.value)
    end
  ) as element;
$$;

-- 他の関数と同じく service_role からしか呼べないようにする。check 制約から
-- 呼ばれる関数は挿入するロールの権限で実行されるので、entries に書く
-- service_role には実行権限が要る。
revoke all on function custom_field_values_length(jsonb) from public;
grant execute on function custom_field_values_length(jsonb) to service_role;

-- 既存の行は上限なしで書かれてきたので、超えている行があると下の
-- `add constraint` は 23514 で失敗する。`not valid` で既存行を見逃すことは
-- しない: 見逃した行はエントリー編集で値をそのまま書き戻しただけで制約に
-- かかり、参加者には 500 として見えるため。代わりに、超えている行を数えて
-- どの項目かを添えて止め、適用前の確認(`docs/supabase-deployment.md`)で
-- 直してから流し直す。
do $$
declare
  v_over text;
begin
  select string_agg(format('%s: %s 件', column_name, over_count), ', ')
  into v_over
  from (
    select 'name' as column_name, count(*) filter (where char_length(name) > 100) as over_count from entries
    union all
    select 'furigana', count(*) filter (where char_length(furigana) > 100) from entries
    union all
    select 'display_name', count(*) filter (where char_length(display_name) > 100) from entries
    union all
    select 'free_text', count(*) filter (where char_length(free_text) > 2000) from entries
    union all
    select 'custom_field_values', count(*) filter (where custom_field_values_length(custom_field_values) > 10000) from entries
  ) as counts
  where over_count > 0;

  if v_over is not null then
    raise exception '上限を超える entries の行があるため entries_text_lengths を張れません(%)', v_over
      using hint = 'docs/supabase-deployment.md の「入力長の上限を張る前の確認」の手順で該当行を直してから適用し直してください';
  end if;
end;
$$;

alter table entries
  add constraint entries_text_lengths check (
    char_length(name) <= 100
    and char_length(furigana) <= 100
    and char_length(display_name) <= 100
    and (free_text is null or char_length(free_text) <= 2000)
    and custom_field_values_length(custom_field_values) <= 10000
  );
