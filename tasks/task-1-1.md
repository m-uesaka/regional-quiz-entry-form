[← tasks.md](../tasks.md) / Phase 1: データモデル設計 ✅完了

### Task 1-1: Supabase スキーマ定義(DDL マイグレーション) ✅

#### 実装・更新内容

* 以下のテーブルをマイグレーションとして定義する。
  * `regions`: 地域マスタ
  * `tournaments`: 大会(地域 × 種別)。エントリー期間、定員、ステータスを持つ
  * `regulations`: 大会ごとのレギュレーション条件。優先期間(`priority_starts_at` / `priority_ends_at`)を持てる
  * `form_field_defs`: 大会ごとの追加フォーム項目定義(YAML から展開)
  * `participants`: 参加者アカウント(email 一意、地域にひもづく)
  * `entries`: participant × tournament のエントリー本体
  * `email_verification_tokens`: エントリー確認メール用トークン
  * `password_reset_tokens`: パスワード再設定用トークン(使い捨て)
  * `staff_accounts`: 地域スタッフ / 統括スタッフのアカウント

#### コードスニペット

`supabase/migrations/0001_init.sql`

```sql
create type tournament_type as enum ('saikyoi', 'shinjinou');
create type entry_status as enum ('pending_verification', 'confirmed', 'waitlisted', 'cancelled');
create type staff_role as enum ('regional', 'general');

create table regions (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null
);

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references regions (id),
  type tournament_type not null,
  name text not null,
  capacity integer,
  entry_opens_at timestamptz not null,
  entry_closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (region_id, type)
);

create table regulations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id),
  label text not null,
  priority_starts_at timestamptz,
  priority_ends_at timestamptz,
  display_order integer not null default 0
);

create table form_field_defs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id),
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('checkbox', 'radio', 'textarea')),
  required boolean not null default false,
  options jsonb,
  display_order integer not null default 0,
  unique (tournament_id, field_key)
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references regions (id),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants (id),
  tournament_id uuid not null references tournaments (id),
  name text not null,
  furigana text not null,
  display_name text not null,
  regulation_id uuid not null references regulations (id),
  free_text text,
  custom_field_values jsonb not null default '{}',
  status entry_status not null default 'pending_verification',
  waitlist_position integer,
  email_verified_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, tournament_id)
);

create table email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries (id),
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants (id),
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table staff_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role staff_role not null,
  region_id uuid references regions (id),
  tournament_type tournament_type,
  created_at timestamptz not null default now()
);
```

#### テスト

* 手動確認: `supabase db push` がエラーなく適用できること
* In `apps/backend/src/lib/db-schema.test.ts`(ローカル Supabase を使った統合テスト)
  * `entries table enforces unique participant/tournament pair`
    * 同じ participant_id + tournament_id で 2 回 insert し、2 回目が一意制約違反になることを assert する

#### 依存タスク

* Task 0-5
