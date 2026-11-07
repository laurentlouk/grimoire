alter table public.tasks
  add column due_on date,
  add column priority smallint not null default 0,
  alter column notes type varchar(500),
  drop column title cascade,
  add column summary text not null default '';

alter table public.tasks rename column notes to details;
alter table public.tasks alter column priority drop default;
alter table public.projects add column archived boolean not null default false;
alter table public.projects add constraint projects_owner_name_key unique (owner_id, name);
create unique index tasks_project_summary_uq on public.tasks (project_id, lower(summary)) where details is not null;

alter table public.tasks enable row level security;
create policy "tasks of own projects" on public.tasks for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
