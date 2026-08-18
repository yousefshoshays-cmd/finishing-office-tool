-- ============================================================================
--  المرحلة ٧ — الاشتراكات وطلبات الدفع
-- ============================================================================
--  لماذا التحصيل يدوي وليس ببوابة دفع؟
--  بوابات مصر (Paymob, Fawry, Kashier) تشترط سجلًا تجاريًا وبطاقة ضريبية
--  وأسابيع مراجعة، وStripe لا يدعم التحصيل في مصر. أي وعد بغير ذلك اليوم
--  سيؤخّر إطلاقك شهورًا بلا مقابل.
--
--  الحل هنا: المكتب يدفع بإنستاباي أو محفظة، ثم يسجّل الطلب من داخل التطبيق.
--  يظهر لك في لوحة الإدارة فتعتمده بضغطة، فيُفعَّل الاشتراك فورًا.
--
--  الجدول مصمّم ليستقبل بوابة دفع لاحقًا دون إعادة كتابة: يكفي أن يملأ
--  الـ webhook حقلي provider و provider_ref ويستدعي approve_payment.
--
--  شغّله بعد 006_admin_panel.sql
-- ============================================================================

-- ---------- الخطط ----------
create table if not exists plans (
  code         text primary key,
  name         text not null,
  months       int  not null,
  price_egp    numeric(10,2) not null,
  seats        int  not null default 3,
  is_active    boolean not null default true,
  sort_order   int  not null default 0
);

insert into plans (code, name, months, price_egp, seats, sort_order) values
  ('monthly',  'شهري',        1,  750.00,  3, 1),
  ('biannual', 'نصف سنوي',    6, 3900.00,  5, 2),
  ('annual',   'سنوي',       12, 7200.00, 10, 3)
on conflict (code) do nothing;

-- ---------- طلبات الدفع ----------
create table if not exists payment_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  plan_code     text not null references plans(code),
  amount_egp    numeric(10,2) not null,
  -- 'instapay' | 'wallet' | 'bank' | لاحقًا اسم بوابة الدفع
  method        text not null,
  -- رقم العملية الذي يكتبه المكتب، أو معرّف العملية من البوابة
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

create index if not exists payreq_org_idx    on payment_requests(org_id);
create index if not exists payreq_status_idx on payment_requests(status, created_at desc);

alter table plans            enable row level security;
alter table payment_requests enable row level security;

-- الخطط يراها الجميع (لعرض الأسعار)
drop policy if exists "plans read" on plans;
create policy "plans read" on plans for select using (true);

-- المكتب يرى طلباته فقط؛ مدير المنصّة يرى الكل
drop policy if exists "payreq read"   on payment_requests;
drop policy if exists "payreq insert" on payment_requests;
create policy "payreq read" on payment_requests for select
  using (org_id = my_org() or is_platform_admin());
create policy "payreq insert" on payment_requests for insert
  with check (org_id = my_org() and my_role() = 'owner');

-- ============================================================================
--  تسجيل طلب دفع (يستدعيه مالك المكتب)
-- ============================================================================
create or replace function public.submit_payment(
  plan     text,
  method   text,
  ref      text default '',
  note_txt text default ''
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  p       plans%rowtype;
  the_org uuid;
begin
  the_org := my_org();
  if the_org is null then
    raise exception 'لا يوجد مكتب مرتبط بحسابك';
  end if;
  if my_role() <> 'owner' then
    raise exception 'مالك المكتب فقط يستطيع تسجيل طلب دفع';
  end if;

  select * into p from plans where code = plan and is_active;
  if not found then
    raise exception 'الخطة غير متاحة';
  end if;

  -- منع الطلبات المكرّرة: طلب معلّق واحد في كل وقت
  if exists (select 1 from payment_requests
             where org_id = the_org and status = 'pending') then
    raise exception 'لديك طلب قيد المراجعة بالفعل. سنتواصل معك قريبًا.';
  end if;

  insert into payment_requests (org_id, plan_code, amount_egp, method, reference, note)
  values (the_org, p.code, p.price_egp, method, trim(ref), trim(note_txt));

  return 'تم استلام طلبك. سيُفعَّل اشتراكك بعد مراجعة التحويل.';
end $$;

-- ============================================================================
--  اعتماد أو رفض الطلب (مدير المنصّة)
-- ============================================================================
create or replace function public.review_payment(
  request_id uuid,
  approve    boolean,
  reason     text default ''
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r payment_requests%rowtype;
  p plans%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'غير مصرّح لك';
  end if;

  select * into r from payment_requests where id = request_id;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'هذا الطلب روجع من قبل'; end if;

  if approve then
    select * into p from plans where code = r.plan_code;
    -- التمديد يبني على المتبقي ولا يلغيه
    update orgs
    set status     = 'active',
        paid_until = greatest(coalesce(paid_until, now()), now()) + (p.months || ' months')::interval,
        seats      = greatest(seats, p.seats)
    where id = r.org_id;

    update payment_requests
    set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
    where id = request_id;

    return 'تم التفعيل ' || p.months || ' شهرًا';
  else
    update payment_requests
    set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
        note = coalesce(note,'') || case when reason <> '' then ' | سبب الرفض: ' || reason else '' end
    where id = request_id;
    return 'تم رفض الطلب';
  end if;
end $$;

-- ============================================================================
--  قوائم العرض
-- ============================================================================

-- طلبات مكتبي (للمالك)
create or replace function public.my_payment_requests()
returns table (
  id uuid, plan_code text, amount_egp numeric, method text,
  reference text, status text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select id, plan_code, amount_egp, method, reference, status, created_at
  from payment_requests
  where org_id = my_org()
  order by created_at desc
  limit 20;
$$;

-- كل الطلبات المعلّقة (لمدير المنصّة)
create or replace function public.admin_pending_payments()
returns table (
  id uuid, org_id uuid, org_name text, owner_email text,
  plan_code text, plan_name text, amount_egp numeric,
  method text, reference text, note text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'غير مصرّح لك';
  end if;
  return query
  select r.id, r.org_id, o.name, 
         (select p2.email from profiles p2 where p2.org_id = o.id and p2.role = 'owner' limit 1),
         r.plan_code, pl.name, r.amount_egp,
         r.method, r.reference, r.note, r.created_at
  from payment_requests r
  join orgs  o  on o.id = r.org_id
  join plans pl on pl.code = r.plan_code
  where r.status = 'pending'
  order by r.created_at;
end $$;

-- الخطط المتاحة للعرض
create or replace function public.available_plans()
returns table (code text, name text, months int, price_egp numeric, seats int)
language sql stable security definer set search_path = public as $$
  select code, name, months, price_egp, seats
  from plans where is_active order by sort_order;
$$;

-- ============================================================================
--  تم. لتعديل الأسعار لاحقًا (من SQL أو أضفها للوحة الإدارة):
--    update plans set price_egp = 900 where code = 'monthly';
-- ============================================================================
