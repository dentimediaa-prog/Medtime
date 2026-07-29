-- =============================================================================
-- Employee Attendance & Time Tracking SaaS
-- Complete Database Schema for Supabase (PostgreSQL)
-- =============================================================================
-- Run this ENTIRE script once in the Supabase SQL Editor on a fresh project.
-- It is idempotent-safe on a clean project (uses IF NOT EXISTS / CREATE OR REPLACE
-- wherever possible). Do not run partial sections in isolation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------

-- 1.1 profiles ----------------------------------------------------------------
-- One row per auth.users row. Role lives here and ONLY here.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  email         text not null,
  role          text not null default 'employee' check (role in ('admin','employee')),
  department    text,
  job_title     text,
  phone         text,
  avatar_url    text,
  is_active     boolean not null default true,
  hire_date     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_is_active on public.profiles(is_active);

-- 1.2 attendance ----------------------------------------------------------------
create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  date          date not null default current_date,
  clock_in      timestamptz,
  clock_out     timestamptz,
  total_hours   numeric(6,2) not null default 0,
  status        text not null default 'present' check (status in ('present','late','absent','on_leave')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists idx_attendance_user_date on public.attendance(user_id, date desc);
create index if not exists idx_attendance_date on public.attendance(date);

-- 1.3 breaks ----------------------------------------------------------------
create table if not exists public.breaks (
  id                uuid primary key default gen_random_uuid(),
  attendance_id     uuid not null references public.attendance(id) on delete cascade,
  break_start       timestamptz not null default now(),
  break_end         timestamptz,
  duration_minutes  numeric(6,2) not null default 0,
  break_type        text not null default 'short' check (break_type in ('lunch','short','other')),
  created_at        timestamptz not null default now()
);

create index if not exists idx_breaks_attendance on public.breaks(attendance_id);

-- 1.4 leave_requests ----------------------------------------------------------------
create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  leave_type    text not null check (leave_type in ('sick','vacation','personal','unpaid')),
  start_date    date not null,
  end_date      date not null,
  reason        text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_leave_user on public.leave_requests(user_id);
create index if not exists idx_leave_status on public.leave_requests(status);

-- 1.5 schedules ----------------------------------------------------------------
create table if not exists public.schedules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  day_of_week   smallint not null check (day_of_week between 0 and 6),
  start_time    time not null,
  end_time      time not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists idx_schedules_user on public.schedules(user_id);

-- 1.6 holidays ----------------------------------------------------------------
create table if not exists public.holidays (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  date          date not null,
  is_recurring  boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_holidays_date on public.holidays(date);

-- 1.7 settings ----------------------------------------------------------------
-- Singleton row (org-wide settings). Enforced via a check on id = 1.
create table if not exists public.settings (
  id                    smallint primary key default 1 check (id = 1),
  org_name              text not null default 'My Company',
  work_hours_per_day    numeric(4,2) not null default 8,
  overtime_threshold    numeric(4,2) not null default 8,
  timezone              text not null default 'UTC',
  pay_rate_currency     text not null default 'USD',
  updated_at            timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- 1.8 payroll_records ----------------------------------------------------------------
create table if not exists public.payroll_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  total_hours   numeric(7,2) not null default 0,
  overtime_hours numeric(7,2) not null default 0,
  gross_pay     numeric(10,2) not null default 0,
  generated_at  timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists idx_payroll_user on public.payroll_records(user_id);
create index if not exists idx_payroll_period on public.payroll_records(period_start, period_end);

-- -----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- 2.1 generic updated_at toucher --------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2.2 is_admin() — security definer to safely check role from inside RLS ----
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 2.3 auto-create profile row when a new auth.users row is inserted ---------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 2.4 auto-compute attendance.total_hours when clock_out is set -------------
create or replace function public.compute_attendance_hours()
returns trigger
language plpgsql
as $$
declare
  break_minutes numeric := 0;
begin
  if new.clock_out is not null and new.clock_in is not null then
    select coalesce(sum(duration_minutes), 0) into break_minutes
    from public.breaks
    where attendance_id = new.id;

    new.total_hours := round(
      (extract(epoch from (new.clock_out - new.clock_in)) / 3600.0)
      - (break_minutes / 60.0)
    , 2);

    if new.total_hours < 0 then
      new.total_hours := 0;
    end if;
  end if;
  return new;
end;
$$;

-- 2.5 auto-compute breaks.duration_minutes when break_end is set ------------
create or replace function public.compute_break_duration()
returns trigger
language plpgsql
as $$
begin
  if new.break_end is not null and new.break_start is not null then
    new.duration_minutes := round(extract(epoch from (new.break_end - new.break_start)) / 60.0, 2);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. TRIGGERS
-- -----------------------------------------------------------------------------

-- updated_at triggers
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_attendance_updated_at on public.attendance;
create trigger trg_attendance_updated_at before update on public.attendance
  for each row execute function public.set_updated_at();

drop trigger if exists trg_leave_requests_updated_at on public.leave_requests;
create trigger trg_leave_requests_updated_at before update on public.leave_requests
  for each row execute function public.set_updated_at();

drop trigger if exists trg_schedules_updated_at on public.schedules;
create trigger trg_schedules_updated_at before update on public.schedules
  for each row execute function public.set_updated_at();

drop trigger if exists trg_settings_updated_at on public.settings;
create trigger trg_settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- new user -> profile
drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- attendance hours computation
drop trigger if exists trg_attendance_compute_hours on public.attendance;
create trigger trg_attendance_compute_hours before insert or update on public.attendance
  for each row execute function public.compute_attendance_hours();

-- break duration computation
drop trigger if exists trg_break_compute_duration on public.breaks;
create trigger trg_break_compute_duration before insert or update on public.breaks
  for each row execute function public.compute_break_duration();

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.attendance        enable row level security;
alter table public.breaks            enable row level security;
alter table public.leave_requests    enable row level security;
alter table public.schedules         enable row level security;
alter table public.holidays          enable row level security;
alter table public.settings          enable row level security;
alter table public.payroll_records   enable row level security;

-- 4.1 profiles ----------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_admin_only" on public.profiles;
create policy "profiles_insert_admin_only" on public.profiles
  for insert with check (public.is_admin());

drop policy if exists "profiles_delete_admin_only" on public.profiles;
create policy "profiles_delete_admin_only" on public.profiles
  for delete using (public.is_admin());

-- 4.2 attendance ----------------------------------------------------------------
drop policy if exists "attendance_select_own_or_admin" on public.attendance;
create policy "attendance_select_own_or_admin" on public.attendance
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "attendance_insert_own_or_admin" on public.attendance;
create policy "attendance_insert_own_or_admin" on public.attendance
  for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "attendance_update_own_or_admin" on public.attendance;
create policy "attendance_update_own_or_admin" on public.attendance
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "attendance_delete_admin_only" on public.attendance;
create policy "attendance_delete_admin_only" on public.attendance
  for delete using (public.is_admin());

-- 4.3 breaks ----------------------------------------------------------------
drop policy if exists "breaks_select_own_or_admin" on public.breaks;
create policy "breaks_select_own_or_admin" on public.breaks
  for select using (
    public.is_admin() or
    exists (select 1 from public.attendance a where a.id = attendance_id and a.user_id = auth.uid())
  );

drop policy if exists "breaks_insert_own_or_admin" on public.breaks;
create policy "breaks_insert_own_or_admin" on public.breaks
  for insert with check (
    public.is_admin() or
    exists (select 1 from public.attendance a where a.id = attendance_id and a.user_id = auth.uid())
  );

drop policy if exists "breaks_update_own_or_admin" on public.breaks;
create policy "breaks_update_own_or_admin" on public.breaks
  for update using (
    public.is_admin() or
    exists (select 1 from public.attendance a where a.id = attendance_id and a.user_id = auth.uid())
  );

drop policy if exists "breaks_delete_admin_only" on public.breaks;
create policy "breaks_delete_admin_only" on public.breaks
  for delete using (public.is_admin());

-- 4.4 leave_requests ----------------------------------------------------------------
drop policy if exists "leave_select_own_or_admin" on public.leave_requests;
create policy "leave_select_own_or_admin" on public.leave_requests
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "leave_insert_own" on public.leave_requests;
create policy "leave_insert_own" on public.leave_requests
  for insert with check (user_id = auth.uid());

drop policy if exists "leave_update_own_pending_or_admin" on public.leave_requests;
create policy "leave_update_own_pending_or_admin" on public.leave_requests
  for update using (
    (user_id = auth.uid() and status = 'pending') or public.is_admin()
  )
  with check (
    (user_id = auth.uid() and status = 'pending') or public.is_admin()
  );

drop policy if exists "leave_delete_admin_only" on public.leave_requests;
create policy "leave_delete_admin_only" on public.leave_requests
  for delete using (public.is_admin());

-- 4.5 schedules ----------------------------------------------------------------
drop policy if exists "schedules_select_own_or_admin" on public.schedules;
create policy "schedules_select_own_or_admin" on public.schedules
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "schedules_write_admin_only" on public.schedules;
create policy "schedules_write_admin_only" on public.schedules
  for insert with check (public.is_admin());

drop policy if exists "schedules_update_admin_only" on public.schedules;
create policy "schedules_update_admin_only" on public.schedules
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "schedules_delete_admin_only" on public.schedules;
create policy "schedules_delete_admin_only" on public.schedules
  for delete using (public.is_admin());

-- 4.6 holidays ----------------------------------------------------------------
drop policy if exists "holidays_select_all_authenticated" on public.holidays;
create policy "holidays_select_all_authenticated" on public.holidays
  for select using (auth.role() = 'authenticated');

drop policy if exists "holidays_write_admin_only" on public.holidays;
create policy "holidays_write_admin_only" on public.holidays
  for insert with check (public.is_admin());

drop policy if exists "holidays_update_admin_only" on public.holidays;
create policy "holidays_update_admin_only" on public.holidays
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "holidays_delete_admin_only" on public.holidays;
create policy "holidays_delete_admin_only" on public.holidays
  for delete using (public.is_admin());

-- 4.7 settings ----------------------------------------------------------------
drop policy if exists "settings_select_all_authenticated" on public.settings;
create policy "settings_select_all_authenticated" on public.settings
  for select using (auth.role() = 'authenticated');

drop policy if exists "settings_update_admin_only" on public.settings;
create policy "settings_update_admin_only" on public.settings
  for update using (public.is_admin()) with check (public.is_admin());

-- 4.8 payroll_records ----------------------------------------------------------------
drop policy if exists "payroll_select_own_or_admin" on public.payroll_records;
create policy "payroll_select_own_or_admin" on public.payroll_records
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "payroll_write_admin_only" on public.payroll_records;
create policy "payroll_write_admin_only" on public.payroll_records
  for insert with check (public.is_admin());

drop policy if exists "payroll_update_admin_only" on public.payroll_records;
create policy "payroll_update_admin_only" on public.payroll_records
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payroll_delete_admin_only" on public.payroll_records;
create policy "payroll_delete_admin_only" on public.payroll_records
  for delete using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 5. FIRST ADMIN BOOTSTRAP (manual step, run AFTER your first signup)
-- -----------------------------------------------------------------------------
-- New users default to role = 'employee'. To promote your first admin account,
-- sign up normally through the app once, then run (replace the email):
--
--   update public.profiles set role = 'admin' where email = 'you@yourcompany.com';
--
-- -----------------------------------------------------------------------------
-- END OF SCRIPT
-- -----------------------------------------------------------------------------
