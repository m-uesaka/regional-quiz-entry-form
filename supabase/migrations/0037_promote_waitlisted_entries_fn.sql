-- 定員を増やした・定員なしにしたときに、空いた席の数だけキャンセル待ちを
-- 繰り上げる(#223)。
--
-- これまで繰り上げ(`promote_next_waitlisted_entry()`、0004/0007)が走るのは
-- 確定済みのエントリーがキャンセルされたときだけで、1 席空くごとに 1 件を
-- 繰り上げていた。大会の編集(`PATCH /api/tournaments/:id`)や大会一覧からの
-- 一括登録の上書き(`import_tournament()`、0036)で定員を増やすと、空きが
-- 何席もできるのに誰も繰り上がらなかった。
--
-- `promote_next_waitlisted_entry()` と同じく大会の行をロックしてから確定数を
-- 数えるので、同時に確認リンクを踏んで空席に入ったエントリーとは席を取り
-- 合わない(確定数はそのロックを取った後に読む)。空き = 定員 − 確定数 の件数
-- だけ、キャンセル待ちの先頭(`waitlist_position` の小さい順)から確定にする。
-- 定員が null(定員なし)ならキャンセル待ちを全件確定にする。空きが無ければ
-- 何もしない(定員を減らしても、確定済みのエントリーはそのまま)。
--
-- 返り値は繰り上げたエントリーと参加者のメールアドレスを、元のキャンセル
-- 待ちの順に並べたもの。呼び出し側が繰り上げの通知メールを送る。
create function promote_waitlisted_entries(p_tournament_id uuid)
returns table(entry_id uuid, participant_email text)
language plpgsql
as $$
declare
  v_capacity integer;
  v_free bigint;
begin
  select t.capacity into v_capacity
    from tournaments t where t.id = p_tournament_id for update;
  if not found then
    return;
  end if;

  -- null は「上限なし」。`limit null` は件数を制限しない。
  if v_capacity is not null then
    select v_capacity - count(*) into v_free
      from entries e
      where e.tournament_id = p_tournament_id and e.status = 'confirmed';
    if v_free <= 0 then
      return;
    end if;
  end if;

  return query
    with targets as (
      select w.id, w.waitlist_position
        from entries w
        where w.tournament_id = p_tournament_id and w.status = 'waitlisted'
        order by w.waitlist_position asc
        limit v_free
        for update
    ),
    promoted as (
      update entries e
        set status = 'confirmed', waitlist_position = null
        from targets
        where e.id = targets.id
        returning e.id, e.participant_id, targets.waitlist_position
    )
    select promoted.id, p.email
      from promoted
      join participants p on p.id = promoted.participant_id
      order by promoted.waitlist_position asc;
end;
$$;

revoke all on function promote_waitlisted_entries(uuid) from public;
grant execute on function promote_waitlisted_entries(uuid) to service_role;
