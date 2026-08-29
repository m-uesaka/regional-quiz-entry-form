-- レギュレーションを複数選択できるようにする(issue #112)。
--
-- requirements.md は「レギュレーションは複数の条件があり、どれか一つを最低限
-- でも満たしている必要があります」「(チェックボックス)」と書いており、複数該当
-- し得る。`entries.regulation_id` の単一 FK ではそれを表現できないので、中間
-- テーブルに移す。

-- `entry_regulations` から `entries` へ複合外部キーを張るために必要。`id` は
-- 既に主キーだが、複合 FK の参照先はちょうどその列組の一意制約でなければ
-- ならない。
alter table entries
  add constraint entries_id_tournament_id_key unique (id, tournament_id);

-- `tournament_id` を冗長に持ち、そこから `entries` と `regulations` の双方へ
-- 複合 FK を張る。この 1 列を共有することで
-- 「entry の大会 = この行の大会 = regulation の大会」が推移的に成り立ち、
-- 「あるエントリーが別大会のレギュレーションを参照する」ことが
-- 旧 `entries.regulation_id` の複合 FK と同じく DB レベルで不可能になる。
-- どちらか一方だけでは、もう一方の大会とずれた行を止められない。
create table entry_regulations (
  entry_id uuid not null,
  regulation_id uuid not null,
  tournament_id uuid not null,
  primary key (entry_id, regulation_id),
  foreign key (entry_id, tournament_id)
    references entries (id, tournament_id) on delete cascade,
  foreign key (regulation_id, tournament_id)
    references regulations (id, tournament_id)
);

-- `sync_regulations()` の「まだ参照されているレギュレーションか」判定と、
-- `regulations` 側 FK の参照チェックが引く。主キーの先頭列は `entry_id` なので
-- こちらは別途必要。
create index entry_regulations_regulation_id_idx
  on entry_regulations (regulation_id);

alter table entry_regulations enable row level security;

grant select, insert, update, delete on entry_regulations to service_role;

-- 既存の単一選択を 1 エントリー 1 行として移送してから、旧列を落とす。
insert into entry_regulations (entry_id, regulation_id, tournament_id)
select e.id, e.regulation_id, e.tournament_id from entries e;

alter table entries drop constraint entries_regulation_id_tournament_id_fkey;
alter table entries drop column regulation_id;

-- `sync_regulations()`(migration 0014)の「参照が残っている行は消せない」判定を
-- 中間テーブルへ向け直す。本体のロジックは 0014 のままで、参照先の探し方だけが
-- 変わる。
--
-- ただし 0014 の delete に付いていたロックの議論はここで成り立たなくなる。
-- あちらは「エントリー作成は `entries.tournament_id` の FK でこの関数が
-- `for update` した大会行に `for key share` を取るので直列化される」と書いて
-- いたが、いま参照を持つのは `entries` ではなく `entry_regulations` で、この
-- テーブルは `tournaments` への FK を持たない。しかも Supabase は REST 越し
-- なので `entries` の insert と `entry_regulations` の insert は別トランザク
-- ションになり(`replaceEntryRegulations()` in `apps/backend/src/lib/entries.ts`)、
-- 後者は大会行に何のロックも取らない。よってこの関数とエントリー作成の後半は
-- 直列化されず、次の 2 つの結末があり得る:
--
--   * `entries` の commit 後・`entry_regulations` の insert 前にこの関数が
--     走ると、参照なしと見なしてレギュレーションを消す。参加者側の insert は
--     複合 FK 違反(23503)で落ち、バックエンドはエントリーごと rollback して
--     409 を返す。
--   * 逆に in-use 判定と delete の間に insert が commit すると、delete 自身が
--     23503 で落ちる。呼び出し側(`apps/backend/src/lib/regulations.ts`)は
--     これを「使用中」として扱う。
--
-- どちらも「消されたレギュレーションを参照するエントリーが残る」ことはなく、
-- 塞ぐには 2 つの書き込みを 1 トランザクションにまとめる必要があるため、
-- この窓は許容する。
create or replace function sync_regulations(
  p_tournament_id uuid,
  p_regulations jsonb
)
returns void
language plpgsql
as $$
declare
  v_keep uuid[];
  v_unknown uuid[];
  v_in_use text[];
begin
  perform 1 from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament not found: %', p_tournament_id
      using errcode = 'P0002';
  end if;

  select array_agg(i.id) into v_unknown
  from (
    select (value ->> 'id')::uuid as id
    from jsonb_array_elements(p_regulations)
  ) i
  where i.id is not null
    and not exists (
      select 1 from regulations r
      where r.id = i.id and r.tournament_id = p_tournament_id
    );
  if v_unknown is not null then
    raise exception 'unknown regulations'
      using errcode = 'P0003', detail = array_to_string(v_unknown, ', ');
  end if;

  with input as (
    select
      (value ->> 'id')::uuid as id,
      value ->> 'label' as label,
      (value ->> 'priorityStartsAt')::timestamptz as priority_starts_at,
      (value ->> 'priorityEndsAt')::timestamptz as priority_ends_at,
      (ordinality - 1)::integer as display_order
    from jsonb_array_elements(p_regulations) with ordinality
  ),
  upserted as (
    insert into regulations (
      id, tournament_id, label, priority_starts_at, priority_ends_at,
      display_order
    )
    select
      coalesce(i.id, gen_random_uuid()), p_tournament_id, i.label,
      i.priority_starts_at, i.priority_ends_at, i.display_order
    from input i
    on conflict (id) do update set
      label = excluded.label,
      priority_starts_at = excluded.priority_starts_at,
      priority_ends_at = excluded.priority_ends_at,
      display_order = excluded.display_order
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_keep from upserted;

  select array_agg(r.label order by r.display_order) into v_in_use
  from regulations r
  where r.tournament_id = p_tournament_id
    and not (r.id = any (v_keep))
    and exists (
      select 1 from entry_regulations er where er.regulation_id = r.id
    );
  if v_in_use is not null then
    raise exception 'regulations in use'
      using errcode = 'P0004', detail = array_to_string(v_in_use, '、');
  end if;

  delete from regulations r
  where r.tournament_id = p_tournament_id and not (r.id = any (v_keep));
end;
$$;

revoke all on function sync_regulations(uuid, jsonb) from public;
grant execute on function sync_regulations(uuid, jsonb) to service_role;
