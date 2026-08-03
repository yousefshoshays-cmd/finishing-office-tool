-- ============================================================================
--  المرحلة ٨ — تقوية تسجيل المستخدمين + تشخيص
-- ============================================================================
--  المشكلة: أي خطأ داخل التريجر handle_new_user يُفشل إنشاء المستخدم كلّه،
--  وGoTrue يعيد جسمًا فارغًا {} فلا يعرف أحد السبب.
--
--  الحل هنا:
--   • التريجر لا يرمي استثناءً إلا لسبب واحد مشروع: كود دعوة خاطئ.
--   • أي خطأ آخر يُسجَّل في جدول تشخيص ولا يمنع إنشاء الحساب.
--   • دالة fix_orphan_profiles() تُصلح أي حساب نجا بلا مكتب.
--
--  شغّله بعد 007_billing.sql
-- ============================================================================

-- ---------- جدول تشخيص ----------
create table if not exists signup_errors (
  id         bigserial primary key,
  email      text,
  meta       jsonb,
  err        text,
  at         timestamptz not null default now()
);
alter table signup_errors enable row level security;
drop policy if exists "signup errors admin" on signup_errors;
create policy "signup errors admin" on signup_errors for select using (is_platform_admin());

-- ---------- تريجر التسجيل، نسخة لا تكسر التسجيل ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  code        text;
  office      text;
  target_org  uuid;
  is_first    boolean;
  new_role    text;
begin
  code   := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
  office := trim(coalesce(new.raw_user_meta_data->>'office_name', ''));

  begin
    if code <> '' then
      select id into target_org from orgs where invite_code = code;
      if target_org is null then
        -- هذا الاستثناء الوحيد المشروع: المستخدم يجب أن يعرف أن كوده خاطئ
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
      -- كود دعوة خاطئ: أعد رميه ليصل للمستخدم
      if sqlerrm like '%كود الدعوة%' then
        raise;
      end if;
      -- أي خطأ آخر: سجّله وأكمل. حساب بلا مكتب أفضل من تسجيل فاشل بلا سبب.
      insert into signup_errors (email, meta, err)
      values (new.email, new.raw_user_meta_data, sqlerrm);
      target_org := null;
      new_role   := 'owner';
  end;

  begin
    insert into public.profiles (id, email, name, role, org_id)
    values (
      new.id,
      new.email,
      coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'name','')), ''), split_part(new.email, '@', 1)),
      new_role,
      target_org
    )
    on conflict (id) do update
      set org_id = coalesce(profiles.org_id, excluded.org_id);
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

-- ============================================================================
--  إصلاح الحسابات التي نجت بلا مكتب
-- ============================================================================
create or replace function public.fix_orphan_profiles()
returns text
language plpgsql security definer set search_path = public as $$
declare
  fixed int := 0;
  r     record;
  o     uuid;
begin
  for r in select id, email from profiles where org_id is null loop
    insert into orgs (name) values ('مكتب ' || split_part(r.email, '@', 1))
    returning id into o;
    update profiles set org_id = o, role = 'owner' where id = r.id;
    fixed := fixed + 1;
  end loop;
  return 'تم إصلاح ' || fixed || ' حساب';
end $$;

-- ============================================================================
--  فحص الجاهزية — شغّله لترى ما إذا كان كل شيء في مكانه
-- ============================================================================
create or replace function public.setup_check()
returns table (البند text, الحالة text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select 'جدول المكاتب (orgs)',
         case when to_regclass('public.orgs') is not null then '✅ موجود' else '❌ مفقود — شغّل 005' end
  union all
  select 'عمود org_id في profiles',
         case when exists (select 1 from information_schema.columns
                           where table_name='profiles' and column_name='org_id')
              then '✅ موجود' else '❌ مفقود — شغّل 005' end
  union all
  select 'جدول الخطط (plans)',
         case when to_regclass('public.plans') is not null then '✅ موجود' else '❌ مفقود — شغّل 007' end
  union all
  select 'دوال لوحة الإدارة',
         case when exists (select 1 from pg_proc where proname='admin_list_orgs')
              then '✅ موجودة' else '❌ مفقودة — شغّل 006' end
  union all
  select 'تريجر التسجيل',
         case when exists (select 1 from pg_trigger where tgname='on_auth_user_created')
              then '✅ مفعّل' else '❌ مفقود' end
  union all
  select 'عدد المكاتب المسجّلة', coalesce((select count(*)::text from orgs), '0')
  union all
  select 'حسابات بلا مكتب',
         case when (select count(*) from profiles where org_id is null) = 0
              then '✅ لا يوجد'
              else '⚠️ ' || (select count(*)::text from profiles where org_id is null)
                   || ' — شغّل: select fix_orphan_profiles();' end
  union all
  select 'أخطاء تسجيل مسجّلة',
         case when to_regclass('public.signup_errors') is null then '—'
              when (select count(*) from signup_errors) = 0 then '✅ لا يوجد'
              else '⚠️ ' || (select count(*)::text from signup_errors)
                   || ' — راجع: select * from signup_errors order by at desc;' end;
end $$;

-- ============================================================================
--  للاستخدام:
--    select * from setup_check();              ← فحص شامل
--    select * from signup_errors order by at desc;  ← سبب فشل التسجيل بالضبط
--    select fix_orphan_profiles();             ← إصلاح حسابات بلا مكتب
-- ============================================================================
