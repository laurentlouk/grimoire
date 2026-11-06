create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique not null,
  created_at timestamptz not null default now()
);
