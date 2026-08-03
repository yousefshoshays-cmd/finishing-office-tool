-- ============================================================================
--  المرحلة ٥ — تعدّد المكاتب (Multi-tenancy) + بوابة الترخيص
-- ============================================================================
--  يعمل على قاعدة بياناتك كما هي، مهما كانت الهجرات التي شُغّلت قبله.
--  المطلوب فعليًا: جدولا kv و profiles فقط — وهما ما يستخدمه التطبيق.
--  أي جدول آخر (clients, site_visits, audit_log) يُعالَج فقط إن كان موجودًا.
--
--  آمن تمامًا: لا يحذف بيانات. ينشئ مكتبًا واحدًا وينقل كل الصفوف الحالية إليه.
--
--  Supabase → SQL Editor → New query → الصق الكل → Run
-- ============================================================================

-- ---------- ١. جدول المكاتب ----------
create table if not exists orgs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null default '',
  phone           text default '',
  address         text default '',
  status          text not null default 'trial'
                  check (status in ('trial','active','expired','suspended')),
  trial_ends_at   timestamptz not null default (now() + interval '14 days'),
  paid_until      timestamptz,
  seats           int not null default 3,
  invite_code     text unique not null default upper(substr(md5(random()::text), 1, 8)),
  created_at      timestamptz not null default now()
);

-- ---------- ٢. مدراء المنصّة (أنت) ----------
--  الوحيدون القادرون على تفعيل اشتراك مكتب. مالك المكتب لا يفعّل نفسه.
create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);

-- ---------- ٣. ربط المستخدمين والبيانات بالمكاتب ----------
alter table profiles add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table kv       add column if not exists org_id uuid references orgs(id) on delete cascade;

create index if not exists profiles_org_idx on profiles(org_id);
create index if not exists kv_org_idx       on kv(org_id);

-- الجداول الاختيارية: تُعالَج فقط إن كانت موجودة
do $$
declare t text;
begin
  foreach t in array array['clients','site_visits','audit_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table %I add column if not exists org_id uuid references orgs(id) on delete cascade', t);
      execute format('create index if not exists %I on %I(org_id)', t || '_org_idx', t);
    end if;
  end loop;
end $$;

-- ---------- ٤. ترحيل كل الموجود إلى مكتب واحد ----------
do $$
declare
  first_org uuid;
  t text;
begin
  if not exists (select 1 from orgs) then
    insert into orgs (name, status, paid_until)
    values ('المكتب الرئيسي', 'active', now() + interval '10 years')
    returning id into first_org;

    update profiles set org_id = first_org where org_id is null;
    update kv       set org_id = first_org where org_id is null;

    foreach t in array array['clients','site_visits','audit_log'] loop
      if to_regclass('public.' || t) is not null then
        execute format('update %I set org_id = %L where org_id is null', t, first_org);
      end if;
    end loop;

    insert into platform_admins (user_id)
    select id from profiles where role = 'owner' limit 1
    on conflict do nothing;
  end if;
end $$;

-- ---------- ٥. مفتاح kv يصبح مركّبًا (مكتب + مفتاح) ----------
--  قبله كان `key` وحده مفتاحًا، أي أن إعدادات مكتب تدهس إعدادات مكتب آخر.
do $$
declare any_org uuid;
begin
  -- أمان: أي صف بلا مكتب يُنسب لأول مكتب. المفتاح الأساسي لا يقبل قيمًا فارغة.
  select id into any_org from orgs order by created_at limit 1;
  if any_org is not null then
    update profiles set org_id = any_org where org_id is null;
    update kv       set org_id = any_org where org_id is null;
  end if;

  if exists (select 1 from pg_constraint
             where conrelid = 'public.kv'::regclass and contype = 'p') then
    execute (select 'alter table kv drop constraint ' || quote_ident(conname)
             from pg_constraint where conrelid = 'public.kv'::regclass and contype = 'p');
  end if;
  alter table kv add primary key (org_id, key);
end $$;

-- ============================================================================
--  ٦. دوال مساعدة
-- ============================================================================

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.my_org()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid();
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from platform_admins where user_id = auth.uid());
$$;

-- هل يحقّ لهذا المكتب الكتابة الآن؟
create or replace function public.org_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select
       case
         when o.status = 'suspended' then false
         when o.status = 'active' and (o.paid_until is null or o.paid_until > now()) then true
         when o.status = 'trial'  and o.trial_ends_at > now() then true
         else false
       end
     from orgs o
     join profiles p on p.org_id = o.id
     where p.id = auth.uid()),
    false);
$$;

-- ============================================================================
--  ٧. السياسات — العزل الحقيقي بين المكاتب
-- ============================================================================

alter table orgs            enable row level security;
alter table platform_admins enable row level security;
alter table kv              enable row level security;

drop policy if exists "org read own"   on orgs;
drop policy if exists "org update own" on orgs;
drop policy if exists "org insert"     on orgs;

create policy "org read own" on orgs for select
  using (id = my_org() or is_platform_admin());
create policy "org update own" on orgs for update
  using ((id = my_org() and my_role() = 'owner') or is_platform_admin());
create policy "org insert" on orgs for insert with check (true);

-- يمنع مالك المكتب من تفعيل اشتراكه بنفسه
create or replace function public.protect_license_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    new.status        := old.status;
    new.trial_ends_at := old.trial_ends_at;
    new.paid_until    := old.paid_until;
    new.seats         := old.seats;
  end if;
  return new;
end $$;

drop trigger if exists orgs_protect_license on orgs;
create trigger orgs_protect_license before update on orgs
  for each row execute function protect_license_fields();

drop policy if exists "admins read" on platform_admins;
create policy "admins read" on platform_admins for select using (is_platform_admin());

-- --- kv: هنا كل بيانات التطبيق فعليًا ---
drop policy if exists "kv read"     on kv;
drop policy if exists "kv write"    on kv;
drop policy if exists "kv all"      on kv;
drop policy if exists "kv anon all" on kv;

create policy "kv read" on kv for select
  using (org_id = my_org());
create policy "kv write" on kv for all
  using (org_id = my_org() and org_can_write())
  with check (org_id = my_org() and org_can_write());

-- --- الجداول الاختيارية ---
do $$
begin
  if to_regclass('public.clients') is not null then
    execute 'alter table clients enable row level security';
    execute 'drop policy if exists "clients read"   on clients';
    execute 'drop policy if exists "clients insert" on clients';
    execute 'drop policy if exists "clients update" on clients';
    execute 'drop policy if exists "clients delete" on clients';
    execute $p$create policy "clients read" on clients for select using (
      org_id = my_org() and (my_role() in ('owner','manager')
        or (my_role() = 'engineer' and engineer_id = auth.uid())))$p$;
    execute $p$create policy "clients insert" on clients for insert with check (
      org_id = my_org() and org_can_write() and my_role() in ('owner','manager','engineer'))$p$;
    execute $p$create policy "clients update" on clients for update using (
      org_id = my_org() and org_can_write() and (my_role() in ('owner','manager')
        or (my_role() = 'engineer' and engineer_id = auth.uid())))$p$;
    execute $p$create policy "clients delete" on clients for delete using (
      org_id = my_org() and org_can_write() and my_role() = 'owner')$p$;
  end if;

  if to_regclass('public.client_items') is not null then
    execute 'alter table client_items enable row level security';
    execute 'drop policy if exists "items read"  on client_items';
    execute 'drop policy if exists "items write" on client_items';
    execute $p$create policy "items read" on client_items for select using (
      exists (select 1 from clients c where c.id = client_id and c.org_id = my_org()))$p$;
    execute $p$create policy "items write" on client_items for all using (
      org_can_write() and exists (select 1 from clients c where c.id = client_id and c.org_id = my_org())
    ) with check (
      org_can_write() and exists (select 1 from clients c where c.id = client_id and c.org_id = my_org()))$p$;
  end if;

  if to_regclass('public.site_visits') is not null then
    execute 'alter table site_visits enable row level security';
    execute 'drop policy if exists "visits all"   on site_visits';
    execute 'drop policy if exists "visits read"  on site_visits';
    execute 'drop policy if exists "visits write" on site_visits';
    execute $p$create policy "visits read" on site_visits for select using (org_id = my_org())$p$;
    execute $p$create policy "visits write" on site_visits for all
      using (org_id = my_org() and org_can_write())
      with check (org_id = my_org() and org_can_write())$p$;
  end if;

  if to_regclass('public.audit_log') is not null then
    execute 'alter table audit_log enable row level security';
    execute 'drop policy if exists "audit read" on audit_log';
    execute $p$create policy "audit read" on audit_log for select
      using (org_id = my_org() and my_role() in ('owner','manager'))$p$;
  end if;
end $$;

-- ============================================================================
--  ٨. التسجيل: انضمام بكود دعوة، أو إنشاء مكتب جديد
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  code        text;
  target_org  uuid;
  is_first    boolean;
  new_role    text;
begin
  code := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));

  if code <> '' then
    select id into target_org from orgs where invite_code = code;
    if target_org is null then
      raise exception 'كود الدعوة غير صحيح';
    end if;
    select not exists(select 1 from profiles where org_id = target_org) into is_first;
    new_role := case when is_first then 'owner' else 'pending' end;
  else
    insert into orgs (name) values (coalesce(new.raw_user_meta_data->>'office_name', ''))
    returning id into target_org;
    new_role := 'owner';
  end if;

  insert into public.profiles (id, email, name, role, org_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new_role,
    target_org
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
--  ٩. ملء org_id تلقائيًا — حتى لا يعتمد الأمان على الواجهة
-- ============================================================================
create or replace function public.set_org_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then
    new.org_id := my_org();
  end if;
  return new;
end $$;

drop trigger if exists kv_set_org on kv;
create trigger kv_set_org before insert on kv
  for each row execute function set_org_id();

do $$
declare t text;
begin
  foreach t in array array['clients','site_visits','audit_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on %I', t || '_set_org', t);
      execute format(
        'create trigger %I before insert on %I for each row execute function set_org_id()',
        t || '_set_org', t);
    end if;
  end loop;
end $$;

-- ============================================================================
--  ١٠. حالة الترخيص للواجهة
-- ============================================================================
create or replace function public.my_license()
returns table (
  org_id        uuid,
  org_name      text,
  status        text,
  can_write     boolean,
  days_left     int,
  invite_code   text,
  seats         int,
  members_count int
)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    o.name,
    o.status,
    org_can_write(),
    greatest(0, extract(day from coalesce(o.paid_until, o.trial_ends_at) - now())::int),
    case when my_role() = 'owner' then o.invite_code else null end,
    o.seats,
    (select count(*)::int from profiles p2 where p2.org_id = o.id and p2.role <> 'pending')
  from orgs o
  join profiles p on p.org_id = o.id
  where p.id = auth.uid();
$$;

-- ============================================================================
--  تم بنجاح.
--   • كل مكتب يرى بياناته فقط.
--   • مكتب جديد يبدأ بتجربة ١٤ يومًا.
--   • بعد انتهائها: قراءة وتصدير فقط حتى تفعّله أنت.
--   • للتفعيل:
--       update orgs set status='active', paid_until = now() + interval '1 month'
--       where name = 'اسم المكتب';
-- ============================================================================
