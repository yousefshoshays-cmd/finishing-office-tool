-- ============================================================================
--  المرحلة ٩ — إصلاح حرج: تسريب البيانات بين المكاتب
-- ============================================================================
--  ما الذي حدث؟
--  السكربت 001 أنشأ سياسات مثل "approved members read kv" تسمح لأي عضو معتمد
--  بقراءة كل الصفوف بلا استثناء. السكربت 005 أضاف سياسات مقيّدة بالمكتب، لكنه
--  لم يحذف القديمة لأنها بأسماء مختلفة.
--
--  وPostgreSQL يجمع السياسات بـ"أو" لا بـ"و": يكفي أن تسمح واحدة ليُسمح
--  بالوصول. فبقيت القديمة تفتح كل شيء، وظهر مكتب جديد يرى بيانات مكتب آخر.
--
--  الحل هنا: مسح كل السياسات على الجداول الحسّاسة ديناميكيًا — مهما كان اسمها
--  ومهما كان السكربت الذي أنشأها — ثم إعادة بناء المقيّدة وحدها.
--
--  ⚠️ شغّله فورًا. لا تُطلق الأداة لأي مكتب قبله.
-- ============================================================================

-- ---------- ١. مسح شامل لكل السياسات القديمة ----------
do $$
declare
  r record;
  t text;
begin
  foreach t in array array['kv','profiles','orgs','platform_admins',
                           'clients','client_items','site_visits','audit_log',
                           'plans','payment_requests'] loop
    if to_regclass('public.' || t) is not null then
      for r in select policyname from pg_policies
               where schemaname = 'public' and tablename = t loop
        execute format('drop policy if exists %I on public.%I', r.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

-- سياسات التخزين (الصور) كانت تسمح لأي عضو معتمد برؤية صور كل المكاتب
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname like '%photo%' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- ---------- ٢. ضمان أن كل صف ينتمي لمكتب ----------
--  صف بلا org_id خطر: شرط org_id = my_org() يعطي NULL لا false،
--  وقد يتصرف بشكل غير متوقع. نغلق الباب بجعل العمود إلزاميًا.
do $$
declare any_org uuid;
begin
  select id into any_org from orgs order by created_at limit 1;
  if any_org is not null then
    update kv       set org_id = any_org where org_id is null;
    update profiles set org_id = any_org where org_id is null;
  end if;
end $$;

alter table kv       alter column org_id set not null;

-- ---------- ٣. إعادة بناء السياسات، مقيّدة بالمكتب فقط ----------

alter table kv       enable row level security;
alter table profiles enable row level security;
alter table orgs     enable row level security;

-- kv: بيانات التطبيق كلها. القراءة داخل المكتب، والكتابة تتطلب ترخيصًا ساريًا.
create policy "kv_read_own_org" on kv for select
  using (org_id is not null and org_id = my_org());

create policy "kv_write_own_org" on kv for all
  using      (org_id is not null and org_id = my_org() and org_can_write())
  with check (org_id is not null and org_id = my_org() and org_can_write());

-- profiles: كل عضو يرى زملاءه في مكتبه فقط — لا موظفي المكاتب الأخرى
create policy "profiles_read_own_org" on profiles for select
  using (org_id = my_org() or id = auth.uid() or is_platform_admin());

create policy "profiles_update_owner" on profiles for update
  using (org_id = my_org() and my_role() = 'owner');

-- orgs
create policy "orgs_read_own" on orgs for select
  using (id = my_org() or is_platform_admin());
create policy "orgs_update_own" on orgs for update
  using ((id = my_org() and my_role() = 'owner') or is_platform_admin());
create policy "orgs_insert" on orgs for insert with check (true);

-- platform_admins
alter table platform_admins enable row level security;
create policy "admins_read" on platform_admins for select using (is_platform_admin());

-- الخطط والمدفوعات
do $$
begin
  if to_regclass('public.plans') is not null then
    execute 'alter table plans enable row level security';
    execute 'create policy "plans_read" on plans for select using (true)';
  end if;
  if to_regclass('public.payment_requests') is not null then
    execute 'alter table payment_requests enable row level security';
    execute $p$create policy "payreq_read" on payment_requests for select
      using (org_id = my_org() or is_platform_admin())$p$;
    execute $p$create policy "payreq_insert" on payment_requests for insert
      with check (org_id = my_org() and my_role() = 'owner')$p$;
  end if;
end $$;

-- الجداول العلائقية إن وُجدت
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

-- ---------- ٤. الصور: معزولة بمجلد المكتب ----------
--  المسار الجديد: {org_id}/{client_id}/{filename}
--  فيصبح العزل جزءًا من اسم الملف نفسه لا من منطق التطبيق.
create policy "photos_read_own_org" on storage.objects for select using (
  bucket_id = 'site-photos'
  and (storage.foldername(name))[1] = my_org()::text
);
create policy "photos_insert_own_org" on storage.objects for insert with check (
  bucket_id = 'site-photos'
  and (storage.foldername(name))[1] = my_org()::text
  and org_can_write()
);
create policy "photos_update_own_org" on storage.objects for update using (
  bucket_id = 'site-photos'
  and (storage.foldername(name))[1] = my_org()::text
  and org_can_write()
);
create policy "photos_delete_own_org" on storage.objects for delete using (
  bucket_id = 'site-photos'
  and (storage.foldername(name))[1] = my_org()::text
  and my_role() = 'owner'
);

-- ============================================================================
--  ٥. فحص التسريب — شغّله بعد الإصلاح للتأكد
-- ============================================================================
create or replace function public.leak_check()
returns table (الفحص text, النتيجة text)
language plpgsql stable security definer set search_path = public as $$
declare
  bad int;
begin
  -- أي سياسة على kv لا تذكر my_org() تعني بابًا مفتوحًا
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

-- ============================================================================
--  بعد التشغيل: select * from leak_check();
--  يجب أن تكون كل الصفوف ✅ قبل أن تُطلق الأداة لأي مكتب.
-- ============================================================================
