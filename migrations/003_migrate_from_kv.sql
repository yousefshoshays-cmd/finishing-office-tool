-- ============================================================================
--  هجرة البيانات من kv إلى الجداول العلائقية
-- ============================================================================
--  ⚠️ قبل التشغيل: خذ نسخة احتياطية من الأداة (الإعدادات → تصدير نسخة احتياطية).
--  السكربت لا يمسح شيئًا من kv. يمكن تشغيله أكثر من مرة بأمان (idempotent).
--  بعد التأكد من صحة البيانات لأسبوع على الأقل، يمكن أرشفة kv يدويًا.
-- ============================================================================

begin;

-- ---------- ١. العملاء ----------
insert into clients (
  id, name, phone, address, area, stage, style, notes,
  folder_link, engineer_name, progress_percent, last_visit_at,
  scope_level, scope_included, created_at
)
select
  coalesce(value ->> 'id', replace(key, 'client:', '')),
  coalesce(value ->> 'name', ''),
  coalesce(value ->> 'phone', ''),
  coalesce(value ->> 'address', ''),
  coalesce(nullif(value ->> 'area','')::numeric, 150),
  coalesce(nullif(value ->> 'stage',''), 'عميل محتمل'),
  coalesce(value ->> 'style', ''),
  coalesce(value ->> 'notes', ''),
  coalesce(value ->> 'folderLink', ''),
  coalesce(value ->> 'engineer', ''),
  coalesce(nullif(value ->> 'progressPercent','')::int, 0),
  nullif(value ->> 'lastVisitAt', '')::date,
  coalesce(value -> 'scopeLevel',    '{}'::jsonb),
  coalesce(value -> 'scopeIncluded', '{}'::jsonb),
  coalesce(nullif(value ->> 'createdAt','')::timestamptz, now())
from kv
where key like 'client:%'
on conflict (id) do nothing;

-- ---------- ٢. ربط المهندس بحسابه عبر الاسم ----------
update clients c
set engineer_id = p.id
from profiles p
where c.engineer_id is null
  and c.engineer_name <> ''
  and p.name = c.engineer_name;

-- ---------- ٣. بنود المقايسة: تفكيك أربع خرائط jsonb إلى صفوف ----------
--  نجمع كل أسماء البنود المذكورة في أي من الخرائط الأربع، ثم نبني صفًا لكل اسم.
with src as (
  select coalesce(value ->> 'id', replace(key,'client:','')) as cid, value as v
  from kv where key like 'client:%'
),
names as (
  select cid, n from src,
    lateral (
      select jsonb_object_keys(coalesce(v->'itemLevel','{}'::jsonb))    as n
      union select jsonb_object_keys(coalesce(v->'itemIncluded','{}'::jsonb))
      union select jsonb_object_keys(coalesce(v->'itemQty','{}'::jsonb))
      union select jsonb_object_keys(coalesce(v->'itemPrice','{}'::jsonb))
    ) k
)
insert into client_items (client_id, item_name, level, included, qty, unit_price, price_date)
select
  n.cid,
  n.n,
  nullif(s.v -> 'itemLevel'    ->> n.n, ''),
  (s.v -> 'itemIncluded' ->> n.n)::boolean,
  nullif(s.v -> 'itemQty'      ->> n.n, '')::numeric,
  nullif(s.v -> 'itemPrice'    ->> n.n, '')::numeric,
  nullif(left(s.v -> 'itemPriceDate' ->> n.n, 10), '')::date
from names n
join src s on s.cid = n.cid
where exists (select 1 from clients c where c.id = n.cid)
on conflict (client_id, item_name) do nothing;

-- ---------- ٤. زيارات الموقع ----------
insert into site_visits (id, client_id, visit_date, engineer_name, progress, notes, photos_link)
select
  coalesce(value ->> 'id', key),
  coalesce(value ->> 'clientId', split_part(key, ':', 2)),
  coalesce(nullif(value ->> 'date','')::date, current_date),
  coalesce(value ->> 'engineer', ''),
  coalesce(nullif(value ->> 'progress','')::int, 0),
  coalesce(value ->> 'notes', ''),
  coalesce(value ->> 'photosLink', '')
from kv
where key like 'visit:%'
  and exists (
    select 1 from clients c
    where c.id = coalesce(kv.value ->> 'clientId', split_part(kv.key, ':', 2))
  )
on conflict (id) do nothing;

commit;

-- ============================================================================
--  التحقق — شغّل هذا بعد الهجرة وقارن الأرقام
-- ============================================================================
select 'عملاء في kv'        as البيان, count(*) from kv where key like 'client:%'
union all
select 'عملاء بعد الهجرة',        count(*) from clients
union all
select 'بنود معدّلة يدويًا',       count(*) from client_items
union all
select 'بنود بسعر متجاوَز',        count(*) from client_items where unit_price is not null
union all
select 'زيارات في kv',            count(*) from kv where key like 'visit:%'
union all
select 'زيارات بعد الهجرة',       count(*) from site_visits
union all
select 'مهندسون بلا ربط بحساب',   count(*) from clients where engineer_name <> '' and engineer_id is null;
