create table public.tasks (
  id bigint generated always as identity primary key,
  project_id bigint not null,
  title text not null,
  status public.task_status not null default 'todo',
  notes text
);

alter table public.tasks
  add constraint tasks_project_id_fkey foreign key (project_id) references public.projects (id) on delete cascade;

alter type public.task_status add value 'done' after 'doing';
alter type public.task_status add value 'blocked' before 'doing';

create index tasks_project_idx on public.tasks (project_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, handle) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'reporting') then
    create role reporting;
  end if;
end
$$;

grant select on public.tasks to authenticated;
comment on table public.tasks is 'the tasks; one per line';
