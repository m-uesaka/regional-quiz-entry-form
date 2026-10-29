-- 大会一覧のスプレッドシートに「定員」「エントリー開始」「エントリー終了」の
-- 列ができたので、一括登録(`import_tournament()`、0028)がそれを書き込む
-- ようにする。あわせて、一括登録は「読み込んで内容を確認し、大会ごとに新規
-- 作成・上書きするかを選んでから実行する」2 段階になったので、呼び出し側が
-- 選んだ操作(新規作成か上書きか)を引数で受け取り、その通りにしか書かない。
--
-- - `p_overwrite = false`(新規作成): 同じ地域・種別の大会が既にあれば何も
--   書かずに SQLSTATE `P0006` で断る。確認画面を開いた後に別の統括スタッフが
--   その大会を作っていた場合に、選ばれていない上書きをしないためである
-- - `p_overwrite = true`(上書き): 大会が無ければ同じく `P0006` で断る。
--   あれば定員・エントリー開始・エントリー終了をシートの値で置き換える。
--   開始もシートに明示されるようになったので、0028 のように「既存の大会の
--   開始は変えない」必要はなくなった。大会名はシートに無いので触らない
-- - フォーム定義とレギュレーションの扱いは 0028 と同じ
--
-- 例外はそのまま呼び出し元に返す。返り値は登録した大会の id と、新規作成
-- だったかどうか。
drop function import_tournament(
  uuid, tournament_type, timestamptz, timestamptz, jsonb, jsonb
);

create function import_tournament(
  p_region_id uuid,
  p_type tournament_type,
  p_overwrite boolean,
  p_capacity integer,
  p_entry_opens_at timestamptz,
  p_entry_closes_at timestamptz,
  p_form_fields jsonb,
  p_regulations jsonb
)
returns table (
  tournament_id uuid,
  created boolean
)
language plpgsql
as $$
declare
  v_id uuid;
  v_regulations jsonb;
begin
  if p_overwrite then
    update tournaments t
      set capacity = p_capacity,
        entry_opens_at = p_entry_opens_at,
        entry_closes_at = p_entry_closes_at
      where t.region_id = p_region_id and t.type = p_type
      returning t.id into v_id;
    if v_id is null then
      raise exception 'the tournament to overwrite does not exist'
        using errcode = 'P0006';
    end if;
  else
    insert into tournaments as t (
      region_id, type, name, capacity, entry_opens_at, entry_closes_at
    )
    values (
      p_region_id, p_type, null, p_capacity, p_entry_opens_at,
      p_entry_closes_at
    )
    on conflict (region_id, type) do nothing
    returning t.id into v_id;
    if v_id is null then
      raise exception 'the tournament to create already exists'
        using errcode = 'P0006';
    end if;
  end if;

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

  return query select v_id, not p_overwrite;
end;
$$;

revoke all on function import_tournament(
  uuid, tournament_type, boolean, integer, timestamptz, timestamptz, jsonb,
  jsonb
) from public;
grant execute on function import_tournament(
  uuid, tournament_type, boolean, integer, timestamptz, timestamptz, jsonb,
  jsonb
) to service_role;
