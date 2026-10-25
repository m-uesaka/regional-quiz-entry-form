-- 大会一覧のスプレッドシートからの一括登録(#168)で、1 大会ぶんの登録を
-- 1 トランザクションで行う。
--
-- 1 大会の登録は「大会の作成または上書き」「フォーム定義の置き換え」
-- 「レギュレーションの同期」の 3 つからなる。API から別々に呼ぶと、たとえば
-- 使用中のレギュレーションを消そうとして 3 つ目だけが失敗したとき、大会と
-- フォーム定義は上書きされたまま残り、「エラーが出た大会は登録しない」
-- (エラーの出た大会はスタッフが手動で登録する)が成り立たない。ここでは 3 つを
-- 1 つの関数にまとめ、どれかが失敗すれば大会ごと元に戻す。
--
-- - 大会は `(region_id, type)` で一意なので、既にあればエントリーの**締切だけ**を
--   上書きする。開始(`p_entry_opens_at` = 登録した時刻)を使うのは新規作成の
--   ときだけで、既存の大会の開始は変えない。一括登録はエラーの出た行を直して
--   何度も流し直すものなので、流し直すたびに来週受付開始の大会が即時受付開始に
--   なったり、受付中の大会の開始時刻が書き換わったりしてはいけない。大会名・
--   定員はシートに無いので触らない。新規作成では大会名を null(地域名＋種別の
--   既定名、0024)、定員を null(定員なし)にする
-- - フォーム定義は `sync_form_field_defs()`(0002)でそのまま置き換える
-- - レギュレーションは `sync_regulations()`(0014/0018)に渡す前に、同じ大会の
--   既存のレギュレーションを**名前で**突き合わせて id を引き継ぐ。シートには
--   id が無いので、引き継がないと既存のレギュレーションはすべて「消して作り
--   直す」扱いになり、エントリーが 1 件でもあれば `P0004`(使用中)で失敗する。
--   名前が変わったレギュレーションは新しいものとして扱われ、古い方が使用中なら
--   同じく `P0004` になる(その大会はエラーとして報告され、何も書かれない)
--
-- 例外(`P0003` / `P0004` / 制約違反など)はそのまま呼び出し元に返す。
--
-- 返り値は登録した大会の id、新規作成だったかどうか、登録後のエントリー開始
-- (既存の大会では元の値のまま)。
create function import_tournament(
  p_region_id uuid,
  p_type tournament_type,
  p_entry_opens_at timestamptz,
  p_entry_closes_at timestamptz,
  p_form_fields jsonb,
  p_regulations jsonb
)
returns table (
  tournament_id uuid,
  created boolean,
  entry_opens_at timestamptz
)
language plpgsql
as $$
declare
  v_id uuid;
  v_created boolean;
  v_entry_opens_at timestamptz;
  v_regulations jsonb;
begin
  -- `xmax = 0` is true only for a row this statement inserted, which is how
  -- an upsert tells a new row from one it updated.
  insert into tournaments as t (
    region_id, type, name, entry_opens_at, entry_closes_at
  )
  values (p_region_id, p_type, null, p_entry_opens_at, p_entry_closes_at)
  on conflict (region_id, type) do update set
    entry_closes_at = excluded.entry_closes_at
  returning t.id, (t.xmax = 0), t.entry_opens_at
    into v_id, v_created, v_entry_opens_at;

  perform sync_form_field_defs(v_id, p_form_fields);

  select coalesce(
    jsonb_agg(
      case
        when existing.id is null then e.elem
        else e.elem || jsonb_build_object('id', existing.id)
      end
      order by e.ord
    ),
    '[]'::jsonb
  )
  into v_regulations
  from jsonb_array_elements(p_regulations) with ordinality as e(elem, ord)
  left join lateral (
    select r.id
      from regulations r
      where r.tournament_id = v_id and r.label = e.elem ->> 'label'
      order by r.display_order
      limit 1
  ) existing on true;

  perform sync_regulations(v_id, v_regulations);

  return query select v_id, v_created, v_entry_opens_at;
end;
$$;

revoke all on function import_tournament(
  uuid, tournament_type, timestamptz, timestamptz, jsonb, jsonb
) from public;
grant execute on function import_tournament(
  uuid, tournament_type, timestamptz, timestamptz, jsonb, jsonb
) to service_role;
