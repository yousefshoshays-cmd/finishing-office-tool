-- ============================================================================
--  المرحلة ١ — الوضع الكامل: تسجيل دخول حقيقي + أدوار معتمدة من الخادم
-- ============================================================================
--  شغّله في: Supabase Dashboard → SQL Editor → New query → لصق → Run
--
--  قبله: Authentication → General configuration → أطفئ Allow anonymous sign-ins
--        ثم:  delete from auth.users where is_anonymous = true;
-- ============================================================================

-- shared data store (clients, settings) — access gated by approved role below
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- one row per real person, role assigned server-side only (never trusts the app)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'pending' check (role in ('pending','engineer','manager','owner')),
  created_at timestamptz not null default now()
);

-- first person ever to sign up becomes owner automatically; everyone after
-- starts 'pending' until an existing owner approves them from the app
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select not exists(select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when is_first then 'owner' else 'pending' end
  );
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table kv enable row level security;
alter table profiles enable row level security;

-- remove any older, less-strict policies from a previous version of this setup
drop policy if exists "authenticated read" on kv;
drop policy if exists "authenticated insert" on kv;
drop policy if exists "authenticated update" on kv;
drop policy if exists "authenticated delete" on kv;
drop policy if exists "approved members read kv" on kv;
drop policy if exists "approved members insert kv" on kv;
drop policy if exists "approved members update kv" on kv;
drop policy if exists "approved members delete kv" on kv;
drop policy if exists "authenticated read profiles" on profiles;
drop policy if exists "owners update profiles" on profiles;

-- kv: only people an owner has actually approved (role owner/engineer) may read or write
create policy "approved members read kv" on kv for select
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members insert kv" on kv for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members update kv" on kv for update
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members delete kv" on kv for delete
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));

-- profiles: anyone signed in can see the roster (needed to show pending/team lists);
-- only an existing owner can ever change someone's role — enforced twice (policy + trigger)
create policy "authenticated read profiles" on profiles for select
  using (auth.role() = 'authenticated');
create policy "owners update profiles" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));

create or replace function public.prevent_self_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requester_role text;
begin
  select role into requester_role from profiles where id = auth.uid();
  if new.role is distinct from old.role and coalesce(requester_role,'') <> 'owner' then
    new.role := old.role;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_role_change on profiles;
create trigger enforce_role_change before update on profiles
  for each row execute procedure public.prevent_self_role_escalation();

alter publication supabase_realtime add table kv;
alter publication supabase_realtime add table profiles;

-- ---------- توافق مع نسخة سابقة قد تكون طُبّقت بدون دور المدير ----------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('pending','engineer','manager','owner'));
