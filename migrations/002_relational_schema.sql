-- ============================================================================
--  المرحلة ٢ — نموذج بيانات علائقي + صلاحيات على مستوى الصف + سجل تغييرات
-- ============================================================================
--  آمن: لا يمسح جدول kv. البيانات القديمة تبقى كما هي حتى تتأكد من الهجرة.
--  شغّله في Supabase → SQL Editor بعد سكربت الوضع الكامل (المرحلة ١).
-- ============================================================================

-- ---------- دالة مساعدة: دور المستخدم الحالي ----------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

-- ---------- العملاء ----------
create table if not exists clients (
  id                text primary key,
  name              text not null default '',
  phone             text default '',
  address           text default '',
  area              numeric default 150,
  stage             text default 'عميل محتمل',
  style             text default '',
  notes             text default '',
  folder_link       text default '',
  engineer_id       uuid references profiles(id) on delete set null,
  engineer_name     text default '',
  progress_percent  int  default 0,
  last_visit_at     date,
  scope_level       jsonb not null default '{}'::jsonb,
  scope_included    jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists clients_engineer_idx on clients(engineer_id);
create index if not exists clients_stage_idx    on clients(stage);

-- ---------- بنود المقايسة: صف لكل بند بدل blob واحد ----------
--  هذا ما يمنع فقدان العمل: مهندسان يعدّلان بندين مختلفين لنفس العميل
--  لا يمسح أحدهما شغل الآخر، لأن كل بند صف مستقل.
create table if not exists client_items (
  client_id     text not null references clients(id) on delete cascade,
  item_name     text not null,
  level         text,
  included      boolean,
  qty           numeric,
  unit_price    numeric,
  price_date    date,
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now(),
  primary key (client_id, item_name)
);

-- ---------- زيارات الموقع ----------
create table if not exists site_visits (
  id            text primary key,
  client_id     text not null references clients(id) on delete cascade,
  visit_date    date not null,
  engineer_name text default '',
  progress      int  default 0,
  notes         text default '',
  photos_link   text default '',
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists visits_client_idx on site_visits(client_id, visit_date desc);

-- ---------- سجل التغييرات ----------
create table if not exists audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      text not null,
  field       text,
  old_value   text,
  new_value   text,
  actor_id    uuid references profiles(id),
  actor_name  text,
  at          timestamptz not null default now()
);
create index if not exists audit_row_idx on audit_log(table_name, row_id, at desc);

-- ---------- تفعيل الحماية ----------
alter table clients      enable row level security;
alter table client_items enable row level security;
alter table site_visits  enable row level security;
alter table audit_log    enable row level security;

-- ============================================================================
--  الصلاحيات — هذه هي الحدود الحقيقية. واجهة المتصفح تخفي الأزرار فقط.
-- ============================================================================

-- العملاء: المهندس يرى المسندين إليه فقط. المدير والمالك يرون الكل.
drop policy if exists "clients read" on clients;
create policy "clients read" on clients for select using (
  my_role() in ('owner','manager')
  or (my_role() = 'engineer' and engineer_id = auth.uid())
);

drop policy if exists "clients insert" on clients;
create policy "clients insert" on clients for insert with check (
  my_role() in ('owner','manager','engineer')
);

-- المهندس يعدّل عملاءه فقط، ولا يستطيع نقل العميل لمهندس آخر.
drop policy if exists "clients update" on clients;
create policy "clients update" on clients for update using (
  my_role() in ('owner','manager')
  or (my_role() = 'engineer' and engineer_id = auth.uid())
);

-- المسح للمالك وحده.
drop policy if exists "clients delete" on clients;
create policy "clients delete" on clients for delete using (my_role() = 'owner');

-- بنود المقايسة: القراءة والتعديل تتبعان صلاحية العميل نفسه.
drop policy if exists "items read" on client_items;
create policy "items read" on client_items for select using (
  exists (select 1 from clients c where c.id = client_id)
);
drop policy if exists "items write" on client_items;
create policy "items write" on client_items for all using (
  exists (select 1 from clients c where c.id = client_id)
);

-- زيارات الموقع: نفس نطاق العميل.
drop policy if exists "visits all" on site_visits;
create policy "visits all" on site_visits for all using (
  exists (select 1 from clients c where c.id = client_id)
);

-- سجل التغييرات: للقراءة فقط، وللمالك والمدير. لا أحد يعدّله أو يمسحه.
drop policy if exists "audit read" on audit_log;
create policy "audit read" on audit_log for select using (my_role() in ('owner','manager'));

-- ============================================================================
--  قفل سعر الوحدة على الخادم — المكمّل الحقيقي لقفل الواجهة
-- ============================================================================
create or replace function public.guard_unit_price()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('owner','manager') then
    if TG_OP = 'INSERT' then
      new.unit_price := null;
      new.price_date := null;
    elsif new.unit_price is distinct from old.unit_price then
      new.unit_price := old.unit_price;
      new.price_date := old.price_date;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists enforce_unit_price on client_items;
create trigger enforce_unit_price before insert or update on client_items
  for each row execute procedure public.guard_unit_price();

-- ---------- قفل نقل المرحلة إلى "تم التعاقد" وما بعدها ----------
create or replace function public.guard_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare locked text[] := array['تم التعاقد','قيد التنفيذ','تم التسليم'];
begin
  if new.stage is distinct from old.stage
     and new.stage = any(locked)
     and my_role() not in ('owner','manager') then
    new.stage := old.stage;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists enforce_stage on clients;
create trigger enforce_stage before update on clients
  for each row execute procedure public.guard_stage();

-- ---------- تسجيل تلقائي لتغيّرات السعر والمرحلة ----------
create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select name into who from profiles where id = auth.uid();

  if TG_TABLE_NAME = 'client_items' and new.unit_price is distinct from old.unit_price then
    insert into audit_log(table_name,row_id,field,old_value,new_value,actor_id,actor_name)
    values ('client_items', new.client_id || ':' || new.item_name, 'unit_price',
            old.unit_price::text, new.unit_price::text, auth.uid(), who);
  end if;

  if TG_TABLE_NAME = 'clients' and new.stage is distinct from old.stage then
    insert into audit_log(table_name,row_id,field,old_value,new_value,actor_id,actor_name)
    values ('clients', new.id, 'stage', old.stage, new.stage, auth.uid(), who);
  end if;

  return new;
end;
$$;
drop trigger if exists audit_items on client_items;
create trigger audit_items after update on client_items
  for each row execute procedure public.log_change();
drop trigger if exists audit_clients on clients;
create trigger audit_clients after update on clients
  for each row execute procedure public.log_change();

alter publication supabase_realtime add table clients;
alter publication supabase_realtime add table client_items;
alter publication supabase_realtime add table site_visits;
