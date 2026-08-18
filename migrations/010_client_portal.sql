-- ============================================================================
--  الهجرة ١٠ — حد العملاء بالاشتراك + دخول العميل بحساب يُصدره المكتب
-- ============================================================================
--  شغّله بعد ALL_IN_ONE.sql — في: Supabase → SQL Editor → New query → Run
--  آمن للتكرار، ولا يحذف صفًا واحدًا.
--
--  ما ينتجه:
--   • حد أقصى لعدد العملاء لكل مكتب، مربوط بخطة اشتراكه
--   • حساب دخول للعميل يُصدره المكتب: اسم مستخدم وكلمة سر يولّدهما النظام
--     ولا يسجّل العميل نفسه بنفسه
--   • عزل كامل: العميل يرى مشروعه وحده، والمنع من الخادم لا من الواجهة
-- ============================================================================

create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ١ — حد العملاء بالاشتراك
-- ════════════════════════════════════════════════════════════════════════════

alter table plans add column if not exists max_clients int not null default 10;
alter table orgs  add column if not exists max_clients int not null default 5;

--  حدود الخطط. التجربة ٥ عملاء: كافية للتقييم الجادّ، غير كافية للتشغيل
--  الدائم مجانًا. والأرقام قابلة للتعديل من لوحة الإدارة لكل مكتب على حدة.
update plans set max_clients = 15 where code = 'monthly'  and max_clients = 10;
update plans set max_clients = 40 where code = 'biannual' and max_clients = 10;
update plans set max_clients = 100 where code = 'annual'  and max_clients = 10;

--  عدد عملاء المكتب. العملاء مخزّنون في kv بمفاتيح تبدأ بـ client:
create or replace function public.org_client_count(target_org uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from kv
  where org_id = coalesce(target_org, my_org())
    and key like 'client:%';
$$;

create or replace function public.org_client_limit(target_org uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(o.max_clients, 5) from orgs o
  where o.id = coalesce(target_org, my_org());
$$;

--  هل يجوز للمكتب إضافة عميل جديد الآن؟
create or replace function public.can_add_client()
returns boolean language sql stable security definer set search_path = public as $$
  select org_client_count() < org_client_limit();
$$;

/*  المنع في قاعدة البيانات لا في الواجهة.
    لو مُنع في الواجهة وحدها، لكفى تعديل بسيط في المتصفح لتجاوز الحد. */
create or replace function public.enforce_client_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare cnt int; lim int;
begin
  if new.key not like 'client:%' then return new; end if;
  --  التعديل على عميل قائم مسموح دائمًا — الحد على الإضافة لا على العمل
  if exists (select 1 from kv where org_id = new.org_id and key = new.key) then
    return new;
  end if;
  select count(*)::int into cnt from kv where org_id = new.org_id and key like 'client:%';
  select coalesce(max_clients, 5) into lim from orgs where id = new.org_id;
  if cnt >= lim then
    raise exception 'بلغت حد عدد العملاء في اشتراكك (%). رقِّ الاشتراك لإضافة المزيد.', lim;
  end if;
  return new;
end $$;

drop trigger if exists kv_client_limit on kv;
create trigger kv_client_limit before insert on kv
  for each row execute function enforce_client_limit();

--  رفع الحد تلقائيًا عند اعتماد الدفع
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
      seats = greatest(seats, p.seats),
      max_clients = greatest(max_clients, p.max_clients)
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

create or replace function public.admin_set_client_limit(target_org uuid, new_limit int)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'غير مصرّح لك'; end if;
  if new_limit < 1 or new_limit > 5000 then raise exception 'حد غير معقول'; end if;
  update orgs set max_clients = new_limit where id = target_org;
  return 'تم ضبط حد العملاء على ' || new_limit;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ٢ — حساب دخول العميل، يُصدره المكتب
-- ════════════════════════════════════════════════════════════════════════════
--  لا يسجّل العميل نفسه. المكتب يضغط زرًا فيولّد النظام اسم مستخدم
--  وكلمة سر، يسلّمهما للعميل. كلمة السر لا تُخزَّن أبدًا — يُخزَّن تجزيؤها
--  فقط، فحتى من يقرأ قاعدة البيانات لا يستطيع استخراجها.

create table if not exists client_accounts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  client_key    text not null,              -- مفتاح العميل في kv: client:<id>
  client_name   text not null default '',
  username      text not null unique,
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  last_login_at timestamptz,
  login_count   int not null default 0,
  unique (org_id, client_key)
);

create index if not exists client_accounts_org_idx on client_accounts(org_id);

alter table client_accounts enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='client_accounts' loop
    execute format('drop policy if exists %I on public.client_accounts', r.policyname);
  end loop;
end $$;

--  المكتب يرى حسابات عملائه فقط، ومالك المكتب وحده يُصدرها
create policy "client_accounts_read_own_org" on client_accounts for select
  using (org_id = my_org() or is_platform_admin());
create policy "client_accounts_write_owner" on client_accounts for all
  using (org_id = my_org() and my_role() in ('owner','manager'))
  with check (org_id = my_org() and my_role() in ('owner','manager'));

/*  توليد اسم مستخدم وكلمة سر وإصدار الحساب.
    كلمة السر تُعاد مرة واحدة فقط في هذا النداء — بعدها لا سبيل لقراءتها،
    وإنما يُعاد التوليد. هذا مقصود: كلمة سر يمكن استرجاعها ليست سرًا. */
create or replace function public.issue_client_account(
  p_client_key text, p_client_name text default '')
returns table (out_username text, out_password text)
language plpgsql security definer set search_path = public as $$
declare
  u text; pw text; org uuid; tries int := 0;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- بلا حروف تلتبس بالأرقام
begin
  org := my_org();
  if org is null then raise exception 'لا يوجد مكتب مرتبط بحسابك'; end if;
  if my_role() not in ('owner','manager') then
    raise exception 'إصدار حسابات العملاء لمالك المكتب أو مدير المشاريع فقط';
  end if;

  /*  اسم المستخدم بحروف كبيرة فقط ومن نفس الأبجدية غير الملتبسة.
      كان يُولَّد بأحرف مختلطة بينما الدخول يرفعها إلى الكبيرة، فكان
      الحساب يُصدَر سليمًا ولا ينجح الدخول به أبدًا. */
  loop
    tries := tries + 1;
    u := 'C';
    for i in 1..7 loop
      u := u || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from client_accounts ca where ca.username = u) or tries > 12;
  end loop;

  pw := '';
  for i in 1..10 loop
    pw := pw || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;

  insert into client_accounts (org_id, client_key, client_name, username, password_hash, created_by)
  values (org, p_client_key, coalesce(p_client_name,''), u, crypt(pw, gen_salt('bf')), auth.uid())
  on conflict (org_id, client_key) do update
    set username = excluded.username,
        password_hash = excluded.password_hash,
        client_name = excluded.client_name,
        active = true,
        created_at = now(),
        created_by = auth.uid();

  return query select u, pw;
end $$;

--  إعادة توليد كلمة السر وحدها (العميل نسيها)
create or replace function public.reset_client_password(p_client_key text)
returns table (out_username text, out_password text)
language plpgsql security definer set search_path = public as $$
declare pw text; rec client_accounts%rowtype;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if my_role() not in ('owner','manager') then raise exception 'غير مصرّح لك'; end if;
  select * into rec from client_accounts ca
   where ca.org_id = my_org() and ca.client_key = p_client_key;
  if not found then raise exception 'لا يوجد حساب لهذا العميل — أصدره أولًا'; end if;

  pw := '';
  for i in 1..10 loop
    pw := pw || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;

  update client_accounts ca set password_hash = crypt(pw, gen_salt('bf')), active = true
   where ca.id = rec.id;
  return query select rec.username, pw;
end $$;

create or replace function public.revoke_client_account(p_client_key text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('owner','manager') then raise exception 'غير مصرّح لك'; end if;
  update client_accounts ca set active = false
   where ca.org_id = my_org() and ca.client_key = p_client_key;
  return 'تم إيقاف دخول العميل';
end $$;

/*  دخول العميل. يتحقّق من الاسم وكلمة السر ويعيد بيانات مشروعه فقط.

    لماذا تُعاد البيانات من الدالة نفسها بدل جلسة كاملة؟ لأن العميل لا
    يحتاج حسابًا في نظام الصلاحيات أصلًا — لا ينشئ ولا يعدّل ولا يرى
    غير مشروعه. الدالة تعمل بصلاحية مرتفعة لكنها تُرجِع صفًا واحدًا
    محدَّدًا بالاسم وكلمة السر، فلا سبيل لتوسيع النطاق من المتصفح.  */
create or replace function public.client_portal_login(p_username text, p_password text)
returns table (out_client_key text, out_client_name text, out_org_name text, out_payload jsonb)
language plpgsql security definer set search_path = public as $$
declare rec client_accounts%rowtype;
begin
  select * into rec from client_accounts ca
   where ca.username = upper(trim(p_username)) and ca.active;
  if not found then raise exception 'اسم المستخدم أو كلمة السر غير صحيحة'; end if;
  if rec.password_hash <> crypt(p_password, rec.password_hash) then
    raise exception 'اسم المستخدم أو كلمة السر غير صحيحة';
  end if;

  update client_accounts ca
     set last_login_at = now(), login_count = ca.login_count + 1
   where ca.id = rec.id;

  return query
    select rec.client_key, rec.client_name,
           (select name from orgs where id = rec.org_id),
           (select value from kv where org_id = rec.org_id and key = rec.client_key);
end $$;

--  الدالة وحدها هي الباب. لا نمنح صلاحية على الجدول نفسه لغير المسجّلين.
revoke all on function public.client_portal_login(text, text) from public;
grant execute on function public.client_portal_login(text, text) to anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  فحص الهجرة
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.portal_check()
returns table (البند text, الحالة text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select 'جدول حسابات العملاء'::text,
    case when to_regclass('public.client_accounts') is not null then '✅' else '❌' end
  union all select 'حد العملاء في الخطط',
    case when exists (select 1 from information_schema.columns
                      where table_name='plans' and column_name='max_clients') then '✅' else '❌' end
  union all select 'تريجر منع تجاوز الحد',
    case when exists (select 1 from pg_trigger where tgname='kv_client_limit') then '✅' else '❌' end
  union all select 'دالة إصدار الحساب',
    case when exists (select 1 from pg_proc where proname='issue_client_account') then '✅' else '❌' end
  union all select 'دالة دخول العميل',
    case when exists (select 1 from pg_proc where proname='client_portal_login') then '✅' else '❌' end
  union all select 'حد عملاء مكتبك الحالي', coalesce(org_client_limit()::text, '—')
  union all select 'عملاؤك الآن', coalesce(org_client_count()::text, '—');
end $$;

-- ============================================================================
--  بعد التشغيل تحقّق:   select * from portal_check();
-- ============================================================================
