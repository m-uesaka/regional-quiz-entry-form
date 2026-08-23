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
  display_order integer not null default 0,
  unique (id, tournament_id)
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
  regulation_id uuid not null,
  free_text text,
  custom_field_values jsonb not null default '{}',
  status entry_status not null default 'pending_verification',
  waitlist_position integer,
  email_verified_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, tournament_id),
  foreign key (regulation_id, tournament_id) references regulations (id, tournament_id)
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
