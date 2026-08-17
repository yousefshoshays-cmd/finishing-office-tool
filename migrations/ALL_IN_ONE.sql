-- ============================================================================
--  نظام متابعة العملاء والتسعير — الهجرة الكاملة (ملف واحد)
-- ============================================================================
--  يستبدل السكربتات التسعة السابقة. ينتج الحالة النهائية مباشرة.
--
--  آمن للتكرار: يمكن تشغيله أكثر من مرة بلا ضرر.
--  آمن على البيانات: لا يحذف صفًا واحدًا. ينقل الموجود إلى مكتب واحد.
--
--  الاستخدام: Supabase → SQL Editor → New query → الصق الكل → Run
--
--  ما ينتجه:
--   • عزل كامل بين المكاتب (كل مكتب يرى بياناته فقط)
--   • تجربة مجانية ١٤ يومًا ثم قراءة وتصدير فقط
--   • لوحة إدارة منصّة (بلا SQL بعد اليوم)
--   • اشتراكات وطلبات دفع
--   • تسجيل لا ينكسر + سجل أخطاء للتشخيص
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ١ — الجداول
-- ════════════════════════════════════════════════════════════════════════════

-- ---------- المكاتب ----------
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

-- ---------- مدراء المنصّة (أنت) ----------
--  الوحيدون القادرون على تفعيل اشتراك مكتب. مالك المكتب لا يفعّل نفسه.
create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);

-- ---------- تخزين بيانات التطبيق ----------
create table if not exists kv (
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------- المستخدمون ----------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null default '',
  role        text not null default 'pending',
  created_at  timestamptz not null default now()
);

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('pending','engineer','manager','owner'));

-- ---------- الخطط ----------
create table if not exists plans (
  code        text primary key,
  name        text not null,
  months      int  not null,
  price_egp   numeric(10,2) not null,
  seats       int  not null default 3,
  is_active   boolean not null default true,
  sort_order  int  not null default 0
);

insert into plans (code, name, months, price_egp, seats, sort_order) values
  ('monthly',  'شهري',      1,  750.00,  3, 1),
  ('biannual', 'نصف سنوي',  6, 3900.00,  5, 2),
  ('annual',   'سنوي',     12, 7200.00, 10, 3)
on conflict (code) do nothing;

-- ---------- طلبات الدفع ----------
create table if not exists payment_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  plan_code     text not null references plans(code),
  amount_egp    numeric(10,2) not null,
  method        text not null,
  reference     text default '',
  note          text default '',
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  provider      text default 'manual',
  provider_ref  text default '',
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users(id)
);

-- ---------- سجل أخطاء التسجيل (تشخيص) ----------
create table if not exists signup_errors (
  id     bigserial primary key,
  email  text,
  meta   jsonb,
  err    text,
  at     timestamptz not null default now()
);

-- ---------- مساحة صور المواقع ----------
--  خاصة لا عامة: صور مواقع العملاء تحوي عناوين وتفاصيل خاصة.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٢ — ربط كل شيء بالمكاتب
-- ════════════════════════════════════════════════════════════════════════════

alter table profiles add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table kv       add column if not exists org_id uuid references orgs(id) on delete cascade;

create index if not exists profiles_org_idx on profiles(org_id);
create index if not exists kv_org_idx       on kv(org_id);
create index if not exists payreq_org_idx   on payment_requests(org_id);
create index if not exists payreq_status_idx on payment_requests(status, created_at desc);

-- الجداول العلائقية إن كانت موجودة من نسخة سابقة
do $$
declare t text;
begin
  foreach t in array array['clients','site_visits','audit_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I add column if not exists org_id uuid references orgs(id) on delete cascade', t);
      execute format('create index if not exists %I on %I(org_id)', t || '_org_idx', t);
    end if;
  end loop;
end $$;

-- ---------- ترحيل الموجود إلى مكتب واحد ----------
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

-- أي صف بقي بلا مكتب يُنسب لأول مكتب — المفتاح الأساسي لا يقبل قيمًا فارغة
do $$
declare any_org uuid;
begin
  select id into any_org from orgs order by created_at limit 1;
  if any_org is not null then
    update kv       set org_id = any_org where org_id is null;
    update profiles set org_id = any_org where org_id is null;
  end if;
end $$;

-- ---------- مفتاح kv مركّب: (مكتب + مفتاح) ----------
--  بدونه، إعدادات مكتب تدهس إعدادات مكتب آخر.
do $$
begin
  if exists (select 1 from pg_constraint
             where conrelid = 'public.kv'::regclass and contype = 'p') then
    execute (select 'alter table kv drop constraint ' || quote_ident(conname)
             from pg_constraint where conrelid = 'public.kv'::regclass and contype = 'p');
  end if;
  alter table kv add primary key (org_id, key);
exception when others then null;  -- المفتاح مضبوط بالفعل
end $$;

do $$
begin
  alter table kv alter column org_id set not null;
exception when others then null;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٣ — الدوال المساعدة
-- ════════════════════════════════════════════════════════════════════════════

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
     from orgs o join profiles p on p.org_id = o.id
     where p.id = auth.uid()),
    false);
$$;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٤ — مسح كل السياسات القديمة
-- ════════════════════════════════════════════════════════════════════════════
--  حاسم: السياسات تُجمع بـ"أو" لا "و" — يكفي أن تسمح واحدة ليُفتح الباب.
--  أي سياسة قديمة متساهلة تُبطل الجديدة المقيّدة. لذا نمسح الكل بالاسم مهما كان.

do $$
declare r record; t text;
begin
  foreach t in array array['kv','profiles','orgs','platform_admins','plans',
                           'payment_requests','signup_errors',
                           'clients','client_items','site_visits','audit_log'] loop
    if to_regclass('public.' || t) is not null then
      for r in select policyname from pg_policies
               where schemaname = 'public' and tablename = t loop
        execute format('drop policy if exists %I on public.%I', r.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname like '%photo%' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٥ — السياسات النهائية (معزولة بالمكتب)
-- ════════════════════════════════════════════════════════════════════════════

alter table kv              enable row level security;
alter table profiles        enable row level security;
alter table orgs            enable row level security;
alter table platform_admins enable row level security;
alter table plans           enable row level security;
alter table payment_requests enable row level security;
alter table signup_errors   enable row level security;

-- ---------- kv: كل بيانات التطبيق ----------
create policy "kv_read_own_org" on kv for select
  using (org_id is not null and org_id = my_org());
create policy "kv_write_own_org" on kv for all
  using      (org_id is not null and org_id = my_org() and org_can_write())
  with check (org_id is not null and org_id = my_org() and org_can_write());

-- ---------- profiles: زملاء مكتبك فقط ----------
create policy "profiles_read_own_org" on profiles for select
  using (org_id = my_org() or id = auth.uid() or is_platform_admin());
create policy "profiles_update_owner" on profiles for update
  using (org_id = my_org() and my_role() = 'owner');

-- ---------- orgs ----------
create policy "orgs_read_own" on orgs for select
  using (id = my_org() or is_platform_admin());
create policy "orgs_update_own" on orgs for update
  using ((id = my_org() and my_role() = 'owner') or is_platform_admin());
create policy "orgs_insert" on orgs for insert with check (true);

-- ---------- platform_admins ----------
create policy "admins_read" on platform_admins for select using (is_platform_admin());

-- ---------- الخطط والمدفوعات ----------
create policy "plans_read" on plans for select using (true);
create policy "payreq_read" on payment_requests for select
  using (org_id = my_org() or is_platform_admin());
create policy "payreq_insert" on payment_requests for insert
  with check (org_id = my_org() and my_role() = 'owner');

-- ---------- سجل الأخطاء ----------
create policy "signup_errors_admin" on signup_errors for select using (is_platform_admin());

-- ---------- الجداول العلائقية إن وُجدت ----------
do $$
begin
  if to_regclass('public.clients') is not null then
    execute 'alter table clients enable row level security';
    execute $p$create policy "clients_read" on clients for select using (
      org_id = my_org() and (my_role() in ('owner','manager')
        or (my_role() = 'engineer' and engineer_id = auth.uid())))$p$;
    execute $p$create policy "clients_write" on clients for all
      using (org_id = my_org() and org_can_write())
      with check (org_id = my_org() and org_can_write())$p$;
  end if;
  if to_regclass('public.client_items') is not null then
    execute 'alter table client_items enable row level security';
    execute $p$create policy "items_all" on client_items for all using (
      exists (select 1 from clients c where c.id = client_id and c.org_id = my_org())
    ) with check (
      exists (select 1 from clients c where c.id = client_id and c.org_id = my_org()))$p$;
  end if;
  if to_regclass('public.site_visits') is not null then
    execute 'alter table site_visits enable row level security';
    execute $p$create policy "visits_all" on site_visits for all
      using (org_id = my_org())
      with check (org_id = my_org() and org_can_write())$p$;
  end if;
  if to_regclass('public.audit_log') is not null then
    execute 'alter table audit_log enable row level security';
    execute $p$create policy "audit_read" on audit_log for select
      using (org_id = my_org() and my_role() in ('owner','manager'))$p$;
  end if;
end $$;

-- ---------- الصور: معزولة بمجلد المكتب ----------
--  المسار: {org_id}/{client_id}/{visit_id}/{file}
--  العزل جزء من اسم الملف نفسه، لا من منطق التطبيق.
create policy "photos_read_own_org" on storage.objects for select using (
  bucket_id = 'site-photos' and (storage.foldername(name))[1] = my_org()::text
);
create policy "photos_insert_own_org" on storage.objects for insert with check (
  bucket_id = 'site-photos' and (storage.foldername(name))[1] = my_org()::text and org_can_write()
);
create policy "photos_update_own_org" on storage.objects for update using (
  bucket_id = 'site-photos' and (storage.foldername(name))[1] = my_org()::text and org_can_write()
);
create policy "photos_delete_own_org" on storage.objects for delete using (
  bucket_id = 'site-photos' and (storage.foldername(name))[1] = my_org()::text and my_role() = 'owner'
);


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٦ — حماية الترخيص والأدوار
-- ════════════════════════════════════════════════════════════════════════════

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

-- يمنع أي شخص من ترقية دوره بنفسه
create or replace function public.prevent_self_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
declare requester_role text;
begin
  select role into requester_role from profiles where id = auth.uid();
  if new.role is distinct from old.role and coalesce(requester_role,'') <> 'owner' then
    new.role := old.role;
  end if;
  return new;
end $$;

drop trigger if exists enforce_role_change on profiles;
create trigger enforce_role_change before update on profiles
  for each row execute function public.prevent_self_role_escalation();


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٧ — التسجيل
-- ════════════════════════════════════════════════════════════════════════════
--  لا ينكسر أبدًا: أي خطأ داخلي يُسجَّل ويُكمل، عدا كود دعوة خاطئ
--  فالمستخدم يجب أن يعرفه.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  code       text;
  office     text;
  target_org uuid;
  is_first   boolean;
  new_role   text;
begin
  code   := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
  office := trim(coalesce(new.raw_user_meta_data->>'office_name', ''));

  begin
    if code <> '' then
      select id into target_org from orgs where invite_code = code;
      if target_org is null then
        raise exception 'كود الدعوة غير صحيح';
      end if;
      select not exists(select 1 from profiles where org_id = target_org) into is_first;
      new_role := case when is_first then 'owner' else 'pending' end;
    else
      insert into orgs (name) values (office) returning id into target_org;
      new_role := 'owner';
    end if;
  exception
    when others then
      if sqlerrm like '%كود الدعوة%' then raise; end if;
      insert into signup_errors (email, meta, err)
      values (new.email, new.raw_user_meta_data, sqlerrm);
      target_org := null;
      new_role   := 'owner';
  end;

  begin
    insert into public.profiles (id, email, name, role, org_id)
    values (
      new.id, new.email,
      coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'name','')), ''),
               split_part(new.email, '@', 1)),
      new_role, target_org
    )
    on conflict (id) do update set org_id = coalesce(profiles.org_id, excluded.org_id);
  exception
    when others then
      insert into signup_errors (email, meta, err)
      values (new.email, new.raw_user_meta_data, 'profiles: ' || sqlerrm);
  end;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- ملء org_id تلقائيًا ----------
--  حتى لا يعتمد الأمان على الواجهة
create or replace function public.set_org_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then new.org_id := my_org(); end if;
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
      execute format('create trigger %I before insert on %I for each row execute function set_org_id()',
                     t || '_set_org', t);
    end if;
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٨ — دوال الواجهة
-- ════════════════════════════════════════════════════════════════════════════

-- ---------- حالة ترخيص المكتب ----------
create or replace function public.my_license()
returns table (
  org_id uuid, org_name text, status text, can_write boolean,
  days_left int, invite_code text, seats int, members_count int
)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.status, org_can_write(),
    greatest(0, extract(day from coalesce(o.paid_until, o.trial_ends_at) - now())::int),
    case when my_role() = 'owner' then o.invite_code else null end,
    o.seats,
    (select count(*)::int from profiles p2 where p2.org_id = o.id and p2.role <> 'pending')
  from orgs o join profiles p on p.org_id = o.id
  where p.id = auth.uid();
$$;

create or replace function public.am_i_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin();
$$;

-- ---------- لوحة الإدارة ----------
create or replace function public.admin_list_orgs()
returns table (
  id uuid, name text, status text, days_left int, seats int,
  members int, pending int, invite_code text, owner_email text,
  created_at timestamptz, last_active timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك بعرض المكاتب'; end if;
  return query
  select o.id, o.name, o.status,
    greatest(0, extract(day from coalesce(o.paid_until, o.trial_ends_at) - now())::int),
    o.seats,
    (select count(*)::int from profiles p where p.org_id = o.id and p.role <> 'pending'),
    (select count(*)::int from profiles p where p.org_id = o.id and p.role  = 'pending'),
    o.invite_code,
    (select p.email from profiles p where p.org_id = o.id and p.role = 'owner' limit 1),
    o.created_at,
    (select max(k.updated_at) from kv k where k.org_id = o.id)
  from orgs o order by o.created_at desc;
end $$;

create or replace function public.admin_summary()
returns table (total_orgs int, active_orgs int, trial_orgs int,
               expiring_soon int, expired_orgs int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك'; end if;
  return query
  select count(*)::int,
    count(*) filter (where status='active' and (paid_until is null or paid_until > now()))::int,
    count(*) filter (where status='trial' and trial_ends_at > now())::int,
    count(*) filter (where coalesce(paid_until, trial_ends_at) between now() and now() + interval '3 days')::int,
    count(*) filter (where status='suspended' or coalesce(paid_until, trial_ends_at) < now())::int
  from orgs;
end $$;

create or replace function public.admin_set_license(
  target_org uuid, action text, extra_days int default 7)
returns text language plpgsql security definer set search_path = public as $$
declare cur orgs%rowtype;
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك بتعديل التراخيص'; end if;
  select * into cur from orgs where id = target_org;
  if not found then raise exception 'المكتب غير موجود'; end if;

  if action = 'activate_month' then
    update orgs set status='active',
      paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 month'
    where id = target_org;
    return 'تم التفعيل لمدة شهر';
  elsif action = 'activate_year' then
    update orgs set status='active',
      paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 year'
    where id = target_org;
    return 'تم التفعيل لمدة سنة';
  elsif action = 'extend_trial' then
    update orgs set status='trial',
      trial_ends_at = greatest(trial_ends_at, now()) + (extra_days || ' days')::interval
    where id = target_org;
    return 'تم تمديد التجربة ' || extra_days || ' يومًا';
  elsif action = 'suspend' then
    update orgs set status='suspended' where id = target_org;
    return 'تم الإيقاف — المكتب يستطيع القراءة والتصدير فقط';
  elsif action = 'reactivate' then
    update orgs set status = case when paid_until > now() then 'active' else 'trial' end
    where id = target_org;
    return 'تمت إعادة التفعيل';
  else
    raise exception 'إجراء غير معروف: %', action;
  end if;
end $$;

create or replace function public.admin_set_seats(target_org uuid, new_seats int)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك'; end if;
  if new_seats < 1 or new_seats > 500 then
    raise exception 'عدد المقاعد يجب أن يكون بين ١ و ٥٠٠';
  end if;
  update orgs set seats = new_seats where id = target_org;
  return 'تم ضبط المقاعد على ' || new_seats;
end $$;

create or replace function public.admin_rename_org(target_org uuid, new_name text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك'; end if;
  update orgs set name = trim(new_name) where id = target_org;
  return 'تم تغيير الاسم';
end $$;

-- ---------- الاشتراكات ----------
create or replace function public.available_plans()
returns table (code text, name text, months int, price_egp numeric, seats int)
language sql stable security definer set search_path = public as $$
  select code, name, months, price_egp, seats from plans where is_active order by sort_order;
$$;

create or replace function public.submit_payment(
  plan text, method text, ref text default '', note_txt text default '')
returns text language plpgsql security definer set search_path = public as $$
declare p plans%rowtype; the_org uuid;
begin
  the_org := my_org();
  if the_org is null then raise exception 'لا يوجد مكتب مرتبط بحسابك'; end if;
  if my_role() <> 'owner' then raise exception 'مالك المكتب فقط يستطيع تسجيل طلب دفع'; end if;

  select * into p from plans where code = plan and is_active;
  if not found then raise exception 'الخطة غير متاحة'; end if;

  if exists (select 1 from payment_requests where org_id = the_org and status = 'pending') then
    raise exception 'لديك طلب قيد المراجعة بالفعل. سنتواصل معك قريبًا.';
  end if;

  insert into payment_requests (org_id, plan_code, amount_egp, method, reference, note)
  values (the_org, p.code, p.price_egp, method, trim(ref), trim(note_txt));
  return 'تم استلام طلبك. سيُفعَّل اشتراكك بعد مراجعة التحويل.';
end $$;

create or replace function public.review_payment(
  request_id uuid, approve boolean, reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare r payment_requests%rowtype; p plans%rowtype;
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك'; end if;
  select * into r from payment_requests where id = request_id;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'هذا الطلب روجع من قبل'; end if;

  if approve then
    select * into p from plans where code = r.plan_code;
    update orgs set status='active',
      paid_until = greatest(coalesce(paid_until, now()), now()) + (p.months || ' months')::interval,
      seats = greatest(seats, p.seats)
    where id = r.org_id;
    update payment_requests set status='approved', reviewed_at=now(), reviewed_by=auth.uid()
    where id = request_id;
    return 'تم التفعيل ' || p.months || ' شهرًا';
  else
    update payment_requests
    set status='rejected', reviewed_at=now(), reviewed_by=auth.uid(),
        note = coalesce(note,'') || case when reason <> '' then ' | سبب الرفض: ' || reason else '' end
    where id = request_id;
    return 'تم رفض الطلب';
  end if;
end $$;

create or replace function public.my_payment_requests()
returns table (id uuid, plan_code text, amount_egp numeric, method text,
               reference text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, plan_code, amount_egp, method, reference, status, created_at
  from payment_requests where org_id = my_org()
  order by created_at desc limit 20;
$$;

create or replace function public.admin_pending_payments()
returns table (id uuid, org_id uuid, org_name text, owner_email text,
               plan_code text, plan_name text, amount_egp numeric,
               method text, reference text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك'; end if;
  return query
  select r.id, r.org_id, o.name,
    (select p2.email from profiles p2 where p2.org_id = o.id and p2.role='owner' limit 1),
    r.plan_code, pl.name, r.amount_egp, r.method, r.reference, r.note, r.created_at
  from payment_requests r
  join orgs o on o.id = r.org_id
  join plans pl on pl.code = r.plan_code
  where r.status = 'pending' order by r.created_at;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٩ — أدوات الصيانة والفحص
-- ════════════════════════════════════════════════════════════════════════════

-- إصلاح أي حساب نجا بلا مكتب
create or replace function public.fix_orphan_profiles()
returns text language plpgsql security definer set search_path = public as $$
declare fixed int := 0; r record; o uuid;
begin
  for r in select id, email from profiles where org_id is null loop
    insert into orgs (name) values ('مكتب ' || split_part(r.email,'@',1)) returning id into o;
    update profiles set org_id = o, role = 'owner' where id = r.id;
    fixed := fixed + 1;
  end loop;
  return 'تم إصلاح ' || fixed || ' حساب';
end $$;

-- فحص التسريب بين المكاتب — شغّله بعد كل تعديل على السياسات
create or replace function public.leak_check()
returns table (الفحص text, النتيجة text)
language plpgsql stable security definer set search_path = public as $$
declare bad int;
begin
  select count(*) into bad from pg_policies
   where schemaname='public' and tablename='kv'
     and coalesce(qual,'') || coalesce(with_check,'') not like '%my_org%';
  return query select 'سياسات kv غير مقيّدة بالمكتب'::text,
    case when bad = 0 then '✅ لا يوجد' else '❌ ' || bad || ' سياسة مفتوحة!' end;

  select count(*) into bad from pg_policies
   where schemaname='public' and tablename='profiles'
     and coalesce(qual,'') || coalesce(with_check,'') not like '%my_org%'
     and coalesce(qual,'') not like '%auth.uid()%';
  return query select 'سياسات profiles غير مقيّدة'::text,
    case when bad = 0 then '✅ لا يوجد' else '❌ ' || bad || ' سياسة مفتوحة!' end;

  select count(*) into bad from kv where org_id is null;
  return query select 'صفوف kv بلا مكتب'::text,
    case when bad = 0 then '✅ لا يوجد' else '❌ ' || bad || ' صف' end;

  select count(*) into bad from profiles where org_id is null;
  return query select 'حسابات بلا مكتب'::text,
    case when bad = 0 then '✅ لا يوجد'
         else '⚠️ ' || bad || ' — شغّل: select fix_orphan_profiles();' end;

  return query select 'عدد المكاتب'::text, (select count(*)::text from orgs);

  return query select 'توزيع الصفوف على المكاتب'::text,
    coalesce((select string_agg(o.name || ': ' || c, ' · ')
              from (select org_id, count(*) c from kv group by org_id) x
              join orgs o on o.id = x.org_id), 'لا توجد بيانات');
end $$;

-- فحص شامل للإعداد
create or replace function public.setup_check()
returns table (البند text, الحالة text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select 'جدول المكاتب'::text,
    case when to_regclass('public.orgs') is not null then '✅' else '❌' end
  union all select 'عمود org_id في profiles',
    case when exists (select 1 from information_schema.columns
                      where table_name='profiles' and column_name='org_id') then '✅' else '❌' end
  union all select 'جدول الخطط',
    case when to_regclass('public.plans') is not null then '✅' else '❌' end
  union all select 'دوال لوحة الإدارة',
    case when exists (select 1 from pg_proc where proname='admin_list_orgs') then '✅' else '❌' end
  union all select 'تريجر التسجيل',
    case when exists (select 1 from pg_trigger where tgname='on_auth_user_created') then '✅' else '❌' end
  union all select 'عدد المكاتب', (select count(*)::text from orgs)
  union all select 'مدراء المنصّة',
    case when (select count(*) from platform_admins) = 0
         then '⚠️ لا يوجد — أضف نفسك!' else (select count(*)::text from platform_admins) end
  union all select 'أخطاء تسجيل',
    case when (select count(*) from signup_errors) = 0 then '✅ لا يوجد'
         else '⚠️ ' || (select count(*)::text from signup_errors)
              || ' — راجع: select * from signup_errors order by at desc;' end;
end $$;


-- ============================================================================
--  انتهى.
--
--  الخطوة التالية الإلزامية — أضف نفسك مدير منصّة (ضع بريدك):
--
--    insert into platform_admins (user_id)
--    select id from profiles where email = 'بريدك@هنا.com'
--    on conflict do nothing;
--
--  ثم تحقّق:
--    select * from setup_check();
--    select * from leak_check();
--
--  لتفعيل مكتب دفع (أو استخدم لوحة الإدارة داخل التطبيق):
--    update orgs set status='active', paid_until = now() + interval '1 month'
--    where name = 'اسم المكتب';
-- ============================================================================
