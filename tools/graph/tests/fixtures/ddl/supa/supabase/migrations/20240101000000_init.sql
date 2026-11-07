-- Synthetic: a hosted-Postgres project's first migration, with the auth schema the platform provides.
create extension if not exists "pgcrypto" with schema extensions;

create type public.task_status as enum ('todo', 'doing');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique,
  created_at timestamptz not null default now()
);

create table public.projects (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null
);

alter table public.profiles enable row level security;
create policy "profiles are readable" on public.profiles for select using (true);
create policy "own profile" on public.profiles for update using (auth.uid() = id);
