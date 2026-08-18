-- ============================================================================
--  المرحلة ٦ — لوحة إدارة المنصّة
-- ============================================================================
--  الغرض: ألّا تفتح SQL Editor مرة أخرى.
--  كل ما يخصّ تفعيل المكاتب وتمديد التجارب وإيقافها يصبح أزرارًا في التطبيق.
--
--  كل دالة هنا تتحقّق أولًا أن المنفّذ مدير منصّة. لو لم يكن، ترفض فورًا.
--  هذا يعني أن الأمان لا يعتمد على إخفاء الأزرار في الواجهة.
--
--  شغّله بعد 005_multi_tenant.sql.
-- ============================================================================

-- ---------- قائمة كل المكاتب مع مؤشّرات الاستخدام ----------
create or replace function public.admin_list_orgs()
returns table (
  id            uuid,
  name          text,
  status        text,
  days_left     int,
  seats         int,
  members       int,
  pending       int,
  invite_code   text,
  owner_email   text,
  created_at    timestamptz,
  last_active   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'غير مصرّح لك بعرض المكاتب';
  end if;

  return query
  select
    o.id,
    o.name,
    o.status,
    greatest(0, extract(day from coalesce(o.paid_until, o.trial_ends_at) - now())::int),
    o.seats,
    (select count(*)::int from profiles p where p.org_id = o.id and p.role <> 'pending'),
    (select count(*)::int from profiles p where p.org_id = o.id and p.role  = 'pending'),
    o.invite_code,
    (select p.email from profiles p where p.org_id = o.id and p.role = 'owner' limit 1),
    o.created_at,
    (select max(k.updated_at) from kv k where k.org_id = o.id)
  from orgs o
  order by o.created_at desc;
end $$;

-- ---------- تغيير حالة الترخيص ----------
--  action: 'activate_month' | 'activate_year' | 'extend_trial' | 'suspend' | 'reactivate'
create or replace function public.admin_set_license(
  target_org uuid,
  action     text,
  extra_days int default 7
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  cur orgs%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'غير مصرّح لك بتعديل التراخيص';
  end if;

  select * into cur from orgs where id = target_org;
  if not found then
    raise exception 'المكتب غير موجود';
  end if;

  if action = 'activate_month' then
    -- التجديد يضيف على المتبقي ولا يبدأ من الصفر، حتى لا يخسر العميل أيامًا دفع ثمنها
    update orgs set status = 'active',
                    paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 month'
    where id = target_org;
    return 'تم التفعيل لمدة شهر';

  elsif action = 'activate_year' then
    update orgs set status = 'active',
                    paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 year'
    where id = target_org;
    return 'تم التفعيل لمدة سنة';

  elsif action = 'extend_trial' then
    update orgs set status = 'trial',
                    trial_ends_at = greatest(trial_ends_at, now()) + (extra_days || ' days')::interval
    where id = target_org;
    return 'تم تمديد التجربة ' || extra_days || ' يومًا';

  elsif action = 'suspend' then
    update orgs set status = 'suspended' where id = target_org;
    return 'تم الإيقاف — المكتب يستطيع القراءة والتصدير فقط';

  elsif action = 'reactivate' then
    update orgs set status = case when paid_until > now() then 'active' else 'trial' end
    where id = target_org;
    return 'تمت إعادة التفعيل';

  else
    raise exception 'إجراء غير معروف: %', action;
  end if;
end $$;

-- ---------- تغيير عدد المقاعد ----------
create or replace function public.admin_set_seats(target_org uuid, new_seats int)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'غير مصرّح لك بتعديل المقاعد';
  end if;
  if new_seats < 1 or new_seats > 500 then
    raise exception 'عدد المقاعد يجب أن يكون بين ١ و ٥٠٠';
  end if;
  update orgs set seats = new_seats where id = target_org;
  return 'تم ضبط المقاعد على ' || new_seats;
end $$;

-- ---------- تعديل اسم مكتب (لتصحيح الأخطاء الإملائية) ----------
create or replace function public.admin_rename_org(target_org uuid, new_name text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'غير مصرّح لك';
  end if;
  update orgs set name = trim(new_name) where id = target_org;
  return 'تم تغيير الاسم';
end $$;

-- ---------- هل المستخدم الحالي مدير منصّة؟ (للواجهة) ----------
create or replace function public.am_i_platform_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin();
$$;

-- ---------- ملخّص سريع للوحة ----------
create or replace function public.admin_summary()
returns table (
  total_orgs    int,
  active_orgs   int,
  trial_orgs    int,
  expiring_soon int,
  expired_orgs  int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'غير مصرّح لك';
  end if;

  return query
  select
    count(*)::int,
    count(*) filter (where status = 'active' and (paid_until is null or paid_until > now()))::int,
    count(*) filter (where status = 'trial'  and trial_ends_at > now())::int,
    -- المكاتب التي تنتهي خلال ٣ أيام: هذه قائمة اتصالاتك للبيع
    count(*) filter (
      where coalesce(paid_until, trial_ends_at) between now() and now() + interval '3 days'
    )::int,
    count(*) filter (
      where status = 'suspended' or coalesce(paid_until, trial_ends_at) < now()
    )::int
  from orgs;
end $$;

-- ============================================================================
--  تم. بعد تشغيل هذا السكربت ورفع الكود:
--  سيظهر لك تبويب "إدارة المنصّة" داخل التطبيق — لن تحتاج SQL بعد اليوم.
--  التبويب لا يظهر إلا لك؛ المكاتب الأخرى لا تراه ولا تستطيع استدعاء دواله.
-- ============================================================================
