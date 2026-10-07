-- SLS database schema for Supabase.
-- Safe to run more than once: it only creates what is missing.
-- Run in the Supabase dashboard → SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Older databases were created before these columns existed.
alter table public.profiles add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists public.daily_logs (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  log_date date not null,
  day_label text,
  spiritual_done boolean not null default false,
  spiritual_minimum boolean not null default false,
  workout_done boolean not null default false,
  workout_minimum boolean not null default false,
  workout_type text,
  workout_notes text,
  yoga_done boolean not null default false,
  gratitude text not null default '',
  practices jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (profile_id, log_date)
);

alter table public.daily_logs add column if not exists practices jsonb not null default '{}'::jsonb;

-- The app upserts on (profile_id, log_date); older tables may have a surrogate key instead.
create unique index if not exists daily_logs_profile_date_key on public.daily_logs (profile_id, log_date);

-- Row level security: every account can only see and change its own rows.
-- The publishable key in index.html is public by design; these policies are what keep data private.
alter table public.profiles enable row level security;
alter table public.daily_logs enable row level security;

drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "daily_logs: own rows" on public.daily_logs;
create policy "daily_logs: own rows" on public.daily_logs
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
