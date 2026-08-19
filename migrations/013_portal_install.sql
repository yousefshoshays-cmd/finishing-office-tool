-- ============================================================================
--  الهجرة ١٣ — تركيب البوابة تركيبًا لا يفشل
-- ============================================================================
--  شغّلها وحدها. لا تحتاج تشغيل ١٠ أو ١١ قبلها، ولا تتعارض معهما.
--  في: Supabase → SQL Editor → New query → Run.
--
--  لماذا هذا الملف؟
--  محرّر Supabase ينفّذ السكربت كله في معاملة واحدة: أي جملة تفشل تُلغي
--  السكربت بأكمله ولو نجحت التسعون قبلها. والهجرة ١٠ تفترض وجود جداول
--  الاشتراكات (plans/orgs) بصيغة معيّنة — فإن اختلف شيء منها في مشروعك،
--  فشلت جملة واحدة وسقط الملف كله بصمت، فتظهر الأداة وكأن الهجرة لم
--  تُشغَّل أصلًا. وهذا يطابق ما تراه بالضبط.
--
--  هنا كل جزء محمي بفحص وجود مسبق، ولا شيء إجباري:
--   • ما لا يمكن إنشاؤه يُتخطّى ويُذكر في التقرير بدل أن يُسقط الباقي.
--   • آمنة للتكرار تمامًا.
--   • تنتهي بتقرير يقول ماذا رُكّب وماذا نقص ولماذا.
-- ============================================================================

create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
--  ١ — جدول الحسابات
-- ════════════════════════════════════════════════════════════════════════════
--  المفتاح الأجنبي على جدول المكاتب يُضاف فقط إن كان الجدول موجودًا،
--  فلا يسقط التركيب في مشروع بُني بترتيب مختلف.
do $$
begin
  if to_regclass('public.client_accounts') is null then
    if to_regclass('public.orgs') is not null then
      create table public.client_accounts (
        id            uuid primary key default gen_random_uuid(),
        org_id        uuid not null references public.orgs(id) on delete cascade,
        client_key    text not null,
        client_name   text not null default '',
        username      text not null unique,
        password_hash text not null,
        active        boolean not null default true,
        kind          text not null default 'client',
        created_at    timestamptz not null default now(),
        created_by    uuid,
        last_login_at timestamptz,
        login_count   int not null default 0,
        unique (org_id, client_key)
      );
    else
      create table public.client_accounts (
        id            uuid primary key default gen_random_uuid(),
        org_id        uuid not null,
        client_key    text not null,
        client_name   text not null default '',
        username      text not null unique,
        password_hash text not null,
        active        boolean not null default true,
        kind          text not null default 'client',
        created_at    timestamptz not null default now(),
        created_by    uuid,
        last_login_at timestamptz,
        login_count   int not null default 0,
        unique (org_id, client_key)
      );
    end if;
  end if;
end $$;

alter table public.client_accounts add column if not exists kind text not null default 'client';
create index if not exists client_accounts_org_idx on public.client_accounts(org_id);
alter table public.client_accounts enable row level security;

--  السياسات المسموحة تُجمع بـ OR: سياسة قديمة متساهلة واحدة تُبطل الصرامة،
--  لذلك تُحذف كلها أولًا ثم تُعاد.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='client_accounts' loop
    execute format('drop policy if exists %I on public.client_accounts', r.policyname);
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='my_org') then
    execute $p$create policy "accounts_read_own_org" on public.client_accounts
              for select using (org_id = my_org())$p$;
    execute $p$create policy "accounts_write_own_org" on public.client_accounts
              for all using (org_id = my_org()) with check (org_id = my_org())$p$;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ٢ — دوال الإصدار والدخول
-- ════════════════════════════════════════════════════════════════════════════
--  ملاحظة: هذه الدوال تنادي my_org() و my_role() عند التشغيل لا عند
--  الإنشاء، فإنشاؤها ينجح حتى لو لم تكن موجودة بعد.

create or replace function public.portal_alphabet()
returns text language sql immutable as $$
  select 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   -- بلا حروف تلتبس بالأرقام
$$;

create or replace function public.portal_random(p_len int, p_prefix text default '')
returns text language plpgsql as $$
declare s text := p_prefix; a text := portal_alphabet();
begin
  for i in 1..p_len loop
    s := s || substr(a, 1 + floor(random() * length(a))::int, 1);
  end loop;
  return s;
end $$;

create or replace function public.contractor_key(p_name text)
returns text language sql immutable as $$
  select 'contractor:' || upper(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g'))
$$;

--  إصدار حساب — عميلًا كان أو مقاولًا
create or replace function public.issue_portal_account(
  p_kind text, p_key text, p_name text default '')
returns table (out_username text, out_password text)
language plpgsql security definer set search_path = public as $$
declare u text; pw text; org uuid; tries int := 0; prefix text;
begin
  org := my_org();
  if org is null then raise exception 'لا يوجد مكتب مرتبط بحسابك'; end if;
  if my_role() not in ('owner','manager') then
    raise exception 'إصدار الحسابات لمالك المكتب أو مدير المشاريع فقط';
  end if;

  prefix := case when p_kind = 'contractor' then 'K' else 'C' end;
  loop
    tries := tries + 1;
    u := portal_random(7, prefix);
    exit when not exists (select 1 from client_accounts ca where ca.username = u) or tries > 12;
  end loop;
  pw := portal_random(10);

  insert into client_accounts (org_id, client_key, client_name, username, password_hash, created_by, kind)
  values (org, p_key, coalesce(p_name,''), u, crypt(pw, gen_salt('bf')), auth.uid(),
          case when p_kind='contractor' then 'contractor' else 'client' end)
  on conflict (org_id, client_key) do update
    set username = excluded.username,
        password_hash = excluded.password_hash,
        client_name = excluded.client_name,
        kind = excluded.kind,
        active = true,
        created_at = now(),
        created_by = auth.uid();

  return query select u, pw;
end $$;

--  الأسماء التي تناديها الأداة — أغلفة رفيعة فوق الدالة الواحدة أعلاه
create or replace function public.issue_client_account(
  p_client_key text, p_client_name text default '')
returns table (out_username text, out_password text)
language sql security definer set search_path = public as $$
  select * from issue_portal_account('client', p_client_key, p_client_name)
$$;

create or replace function public.issue_contractor_account(p_name text)
returns table (out_username text, out_password text)
language sql security definer set search_path = public as $$
  --  الاسم المعروض يُوحَّد كما يُوحَّد المفتاح: مسافة واحدة بين الكلمات،
  --  وإلا ظهر «حسن   السيد» في بوابة المقاول كما كُتب سهوًا
  select * from issue_portal_account('contractor', contractor_key(p_name),
                                     regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g'))
$$;

create or replace function public.reset_client_password(p_client_key text)
returns table (out_username text, out_password text)
language plpgsql security definer set search_path = public as $$
declare pw text; rec client_accounts%rowtype;
begin
  if my_role() not in ('owner','manager') then raise exception 'غير مصرّح لك'; end if;
  select * into rec from client_accounts ca
   where ca.org_id = my_org() and ca.client_key = p_client_key;
  if not found then raise exception 'لا يوجد حساب لهذا العميل — أصدره أولًا'; end if;

  pw := portal_random(10);
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
  return 'تم إيقاف الدخول';
end $$;

create or replace function public.my_portal_accounts()
returns table (kind text, key text, name text, username text, active boolean,
               last_login_at timestamptz, login_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select ca.kind, ca.client_key, ca.client_name, ca.username, ca.active,
           ca.last_login_at, ca.login_count
      from client_accounts ca
     where ca.org_id = my_org()
     order by ca.kind, ca.client_name;
end $$;

--  كشف حساب المقاول عبر مشاريع المكتب — تعاقده ودفعاته هو وحده
create or replace function public.contractor_statement(p_org uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out_rows jsonb := '[]'::jsonb; r record; mine jsonb; ids text[]; pays jsonb;
begin
  for r in select key, value from kv where org_id = p_org and key like 'client:%' loop
    select coalesce(jsonb_agg(c), '[]'::jsonb) into mine
      from jsonb_array_elements(coalesce(r.value->'contractors', '[]'::jsonb)) c
     where contractor_key(c->>'name') = p_key;
    if mine = '[]'::jsonb then continue; end if;

    select array_agg(c->>'id') into ids from jsonb_array_elements(mine) c;
    select coalesce(jsonb_agg(jsonb_build_object(
             'date', e->>'date', 'amount', e->>'amount', 'retained', e->>'retained',
             'phase', e->>'phase', 'note', e->>'note')), '[]'::jsonb)
      into pays
      from jsonb_array_elements(coalesce(r.value->'expenses', '[]'::jsonb)) e
     where e->>'contractorId' = any(ids);

    out_rows := out_rows || jsonb_build_array(jsonb_build_object(
      'project', coalesce(r.value->>'name','مشروع'),
      'address', coalesce(r.value->>'address',''),
      'contractors', mine, 'payments', pays));
  end loop;
  return out_rows;
end $$;

--  الدخول الموحّد
create or replace function public.portal_login(p_username text, p_password text)
returns table (out_kind text, out_key text, out_name text, out_org_name text, out_payload jsonb)
language plpgsql security definer set search_path = public as $$
declare rec client_accounts%rowtype; org_label text;
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

  --  اسم المكتب اختياري: غيابه لا يمنع الدخول
  begin
    execute 'select name from orgs where id = $1' into org_label using rec.org_id;
  exception when others then org_label := '';
  end;

  if rec.kind = 'contractor' then
    return query select 'contractor'::text, rec.client_key, rec.client_name,
                        coalesce(org_label,''), contractor_statement(rec.org_id, rec.client_key);
  else
    return query select 'client'::text, rec.client_key, rec.client_name, coalesce(org_label,''),
                        jsonb_build_object(
                          'client',   (select value from kv where org_id = rec.org_id and key = rec.client_key),
                          'settings', (select value from kv where org_id = rec.org_id and key = 'settings:global'));
  end if;
end $$;

--  الدالة وحدها هي الباب للزائر غير المسجَّل
--  الأدوار تُمنَح فقط إن كانت موجودة، فلا يسقط الملف في قاعدة مختلفة الإعداد
do $$
begin
  revoke all on function public.portal_login(text, text) from public;
  if exists (select 1 from pg_roles where rolname='anon') then
    grant execute on function public.portal_login(text, text) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.portal_login(text, text)          to authenticated;
    grant execute on function public.issue_client_account(text, text)  to authenticated;
    grant execute on function public.issue_contractor_account(text)    to authenticated;
    grant execute on function public.reset_client_password(text)       to authenticated;
    grant execute on function public.revoke_client_account(text)       to authenticated;
    grant execute on function public.my_portal_accounts()              to authenticated;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ٣ — مساحة صور المواقع والأغلفة
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('site-photos','site-photos', false, 10485760,
          array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = false;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='my_org') then
    execute 'drop policy if exists "photos_read_own_org"   on storage.objects';
    execute 'drop policy if exists "photos_insert_own_org" on storage.objects';
    execute 'drop policy if exists "photos_update_own_org" on storage.objects';
    execute 'drop policy if exists "photos_delete_own_org" on storage.objects';

    execute $p$create policy "photos_read_own_org" on storage.objects for select
              using (bucket_id='site-photos' and (storage.foldername(name))[1] = my_org()::text)$p$;
    execute $p$create policy "photos_insert_own_org" on storage.objects for insert
              with check (bucket_id='site-photos' and (storage.foldername(name))[1] = my_org()::text)$p$;
    execute $p$create policy "photos_update_own_org" on storage.objects for update
              using (bucket_id='site-photos' and (storage.foldername(name))[1] = my_org()::text)$p$;
    execute $p$create policy "photos_delete_own_org" on storage.objects for delete
              using (bucket_id='site-photos' and (storage.foldername(name))[1] = my_org()::text)$p$;
  end if;
exception when insufficient_privilege then
  raise notice 'لا تملك صلاحية تعديل مساحة التخزين — أنشئ site-photos يدويًا من Supabase ← Storage';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ٤ — تحديث فهرس الخادم
-- ════════════════════════════════════════════════════════════════════════════
--  الدالة قد تُنشأ في قاعدة البيانات ولا يجدها التطبيق حتى يُحدَّث الفهرس.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
--  ٥ — التقرير
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.portal_check()
returns table (البند text, الحالة text)
language plpgsql stable security definer set search_path = public as $$
declare
  function_exists constant text := '✅ موجودة';
  function_missing constant text := '❌ مفقودة';
  bucket_state text;
begin
  /*  حالة مساحة التخزين تُقرأ داخل كتلة محمية: في قاعدة بلا مخطط
      storage كان مجرّد ذكر الجدول في الاستعلام يُسقط التقرير كله. */
  begin
    if to_regclass('storage.buckets') is null then
      bucket_state := '— غير متاح';
    else
      execute $q$select case when exists (select 1 from storage.buckets where id='site-photos')
                             then '✅ موجودة'
                             else '❌ مفقودة — أنشئها من Supabase ← Storage' end$q$
        into bucket_state;
    end if;
  exception when others then bucket_state := '— تعذّر الفحص';
  end;
  return query
  select 'جدول الحسابات'::text,
         case when to_regclass('public.client_accounts') is not null then '✅ موجود' else '❌ مفقود' end
  union all select 'دالة إصدار حساب العميل',
         case when exists (select 1 from pg_proc where proname='issue_client_account') then function_exists else function_missing end
  union all select 'دالة إصدار حساب المقاول',
         case when exists (select 1 from pg_proc where proname='issue_contractor_account') then function_exists else function_missing end
  union all select 'دالة الدخول',
         case when exists (select 1 from pg_proc where proname='portal_login') then function_exists else function_missing end
  union all select 'كشف حساب المقاول',
         case when exists (select 1 from pg_proc where proname='contractor_statement') then function_exists else function_missing end
  union all select 'مساحة site-photos', bucket_state
  union all select 'دوال الهوية (my_org / my_role)',
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                            where n.nspname='public' and p.proname='my_org')
              then '✅ موجودة' else '❌ مفقودة — شغّل ALL_IN_ONE.sql أولًا' end
  union all select 'عدد الحسابات المُصدَرة',
         coalesce((select count(*)::text from client_accounts), '0');
end $$;

create or replace function public.storage_check()
returns table (البند text, الحالة text)
language sql stable security definer set search_path = public as $$
  select * from portal_check()
$$;

select * from portal_check();

-- ============================================================================
--  إن ظهر أي ❌ أرسل الجدول كما هو. وإن كانت كل الأسطر ✅ فأعد المحاولة
--  من الأداة بعد عشر ثوانٍ (الفهرس يحتاج لحظة).
-- ============================================================================
