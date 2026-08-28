-- 地域によっては最強位と新人王の両方に参加できる(requirements.md)。
-- 既定は false: 現在の「どの地域でも両方に出られる」挙動は仕様の欠落なので、
-- 移行時に全地域を許可側へ倒すのではなく、地域ごとに明示させる。
alter table regions
  add column allows_dual_entry boolean not null default false;
