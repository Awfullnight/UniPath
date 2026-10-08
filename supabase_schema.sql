-- UniPath production-ready Supabase schema
-- Run this whole file in Supabase SQL Editor before using Cloud mode.

create extension if not exists pgcrypto;

create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('curator','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.student_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.program_content (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('lesson','event','template','question')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.curator_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  title text not null,
  result text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_curator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_roles
    where user_id = auth.uid() and role in ('curator','admin')
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_student_states_updated on public.student_states;
create trigger trg_student_states_updated
before update on public.student_states
for each row execute function public.touch_updated_at();

drop trigger if exists trg_program_content_updated on public.program_content;
create trigger trg_program_content_updated
before update on public.program_content
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.student_states(user_id, data)
  values (
    new.id,
    jsonb_build_object(
      'profile', jsonb_build_object(
        'name', coalesce(new.raw_user_meta_data->>'name',''),
        'email', coalesce(new.email,''),
        'grade', coalesce(new.raw_user_meta_data->>'grade','10'),
        'class_name', coalesce(new.raw_user_meta_data->>'class_name','A'),
        'goal', coalesce(new.raw_user_meta_data->>'goal',''),
        'city', 'Nukus',
        'country', 'Uzbekistan',
        'school', 'UniPath School'
      ),
      'portfolio', '[]'::jsonb,
      'tests', '[]'::jsonb,
      'diagnostic', 'null'::jsonb,
      'lessons', '[]'::jsonb,
      'application', '{}'::jsonb,
      'roadmap', jsonb_build_object('profile',false,'activities',false,'certificates',false,'essay',false,'recommendations',false,'universities',false),
      'attendance', '[]'::jsonb
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.staff_roles enable row level security;
alter table public.student_states enable row level security;
alter table public.program_content enable row level security;
alter table public.curator_logs enable row level security;
alter table public.program_state enable row level security;

drop policy if exists staff_select_own on public.staff_roles;
create policy staff_select_own on public.staff_roles
for select to authenticated
using (auth.uid() = user_id or public.is_curator());

drop policy if exists students_own_or_curator_select on public.student_states;
create policy students_own_or_curator_select on public.student_states
for select to authenticated
using (auth.uid() = user_id or public.is_curator());

drop policy if exists students_own_or_curator_insert on public.student_states;
create policy students_own_or_curator_insert on public.student_states
for insert to authenticated
with check (auth.uid() = user_id or public.is_curator());

drop policy if exists students_own_or_curator_update on public.student_states;
create policy students_own_or_curator_update on public.student_states
for update to authenticated
using (auth.uid() = user_id or public.is_curator())
with check (auth.uid() = user_id or public.is_curator());

drop policy if exists students_own_or_curator_delete on public.student_states;
create policy students_own_or_curator_delete on public.student_states
for delete to authenticated
using (auth.uid() = user_id or public.is_curator());

drop policy if exists content_read_published on public.program_content;
create policy content_read_published on public.program_content
for select to authenticated
using (published = true or public.is_curator());

drop policy if exists content_curator_insert on public.program_content;
create policy content_curator_insert on public.program_content
for insert to authenticated
with check (public.is_curator());

drop policy if exists content_curator_update on public.program_content;
create policy content_curator_update on public.program_content
for update to authenticated
using (public.is_curator())
with check (public.is_curator());

drop policy if exists content_curator_delete on public.program_content;
create policy content_curator_delete on public.program_content
for delete to authenticated
using (public.is_curator());

drop policy if exists program_state_curator_all on public.program_state;
create policy program_state_curator_all on public.program_state
for all to authenticated
using (public.is_curator())
with check (public.is_curator());

drop policy if exists logs_curator_all on public.curator_logs;
create policy logs_curator_all on public.curator_logs
for all to authenticated
using (public.is_curator())
with check (public.is_curator());

-- Storage bucket for private certificates and speaking recordings.
insert into storage.buckets (id, name, public)
values ('student-files', 'student-files', false)
on conflict (id) do nothing;

-- A path should start with the student's auth UUID: <user_id>/certificates/...
-- and <user_id>/speaking/...
-- Admin/curator can access all files.
drop policy if exists student_files_select on storage.objects;
create policy student_files_select on storage.objects
for select to authenticated
using (
  bucket_id = 'student-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_curator()
  )
);

drop policy if exists student_files_insert on storage.objects;
create policy student_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'student-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_curator()
  )
);

drop policy if exists student_files_update on storage.objects;
create policy student_files_update on storage.objects
for update to authenticated
using (
  bucket_id = 'student-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_curator()
  )
)
with check (
  bucket_id = 'student-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_curator()
  )
);

drop policy if exists student_files_delete on storage.objects;
create policy student_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'student-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_curator()
  )
);

-- Seed materials/events used by the first launch.
insert into public.program_content(kind,title,payload,published)
select * from (values
('lesson','IELTS Writing Task 2 — Structure', '{"type":"lesson","grade_from":9,"grade_to":11,"duration":45,"text":"Build a clear thesis, two body paragraphs, evidence, and a conclusion.","task":"Write a 180–220 word opinion response and submit it in your Application notes."}'::jsonb, true),
('lesson','SAT Math — Linear Equations', '{"type":"lesson","grade_from":8,"grade_to":11,"duration":35,"text":"Linear equations, slope, intercepts and word problems.","task":"Complete the SAT Math practice set."}'::jsonb, true),
('lesson','Common App Activities — Strong Descriptions', '{"type":"lesson","grade_from":10,"grade_to":11,"duration":30,"text":"Turn an activity into evidence: role, action, impact, scale.","task":"Rewrite three activities using action + impact."}'::jsonb, true),
('lesson','Personal Statement Workshop', '{"type":"lesson","grade_from":10,"grade_to":11,"duration":50,"text":"Find a focused story and connect it to values and growth.","task":"Create a 5-sentence essay outline."}'::jsonb, true),
('event','IELTS Writing Training', '{"date":"2026-10-15","classes":"9–11","event_type":"Training","description":"Live + platform-based writing session."}'::jsonb, true),
('event','Soft Skills: Communication', '{"date":"2026-10-22","classes":"5–11","event_type":"Seminar","description":"Communication, teamwork and feedback."}'::jsonb, true),
('event','Common App Roadmap', '{"date":"2026-11-05","classes":"10–11","event_type":"Training","description":"Application roadmap workshop."}'::jsonb, true),
('template','CV / Resume Template', '{"type":"template","description":"One-page student CV structure."}'::jsonb, true),
('template','Personal Statement Template', '{"type":"template","description":"Problem → experience → insight → growth → future."}'::jsonb, true),
('template','Activity Description Template', '{"type":"template","description":"Action + responsibility + measurable impact."}'::jsonb, true)
) as x(kind,title,payload,published)
where not exists (select 1 from public.program_content pc where pc.title=x.title);

-- After the first curator account is created in Authentication, add their UUID here:
-- insert into public.staff_roles(user_id, role) values ('YOUR-AUTH-USER-UUID','curator');
