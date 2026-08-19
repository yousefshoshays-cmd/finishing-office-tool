-- ============================================================================
--  الهجرة ١١ — مساحة الصور + حساب دخول للمقاول
-- ============================================================================
--  شغّلها بعد ALL_IN_ONE.sql و010_client_portal.sql
--  في: Supabase → SQL Editor → New query → Run.  آمنة للتكرار.
--
--  ما تحلّه:
--   ١· رسالة «مساحة التخزين site-photos غير موجودة» عند رفع صورة الغلاف
--   ٢· دخول المقاول بحساب يُصدره المكتب — يرى حسابه الجاري وحده
--      عبر كل المشاريع، ولا يرى أرقام العميل ولا قيمة العقد ولا أي مقاول آخر
-- ============================================================================

create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
--  الجزء ١ — مساحة صور المواقع والأغلفة
-- ════════════════════════════════════════════════════════════════════════════
--  خاصة لا عامة: صور مواقع العملاء تحمل عناوين وتفاصيل خاصة، والوصول
--  إليها يكون بروابط موقّتة تنتهي بعد ساعة.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

--  حذف أي سياسات قديمة على نفس المساحة قبل إعادة إنشائها.
--  السبب: السياسات المسموحة تُجمع بـ OR — فسياسة قديمة واحدة متساهلة
--  تُبطل أثر السياسات الجديدة الصارمة كلها.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'photos_%' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

--  أول جزء من مسار الملف هو معرّف المكتب. أي محاولة لقراءة مجلد مكتب
--  آخر تفشل من الخادم نفسه، لا من الواجهة.
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
--  الجزء ٢ — حساب دخول للمقاول
-- ════════════════════════════════════════════════════════════════════════════
--  نفس منطق حساب العميل: المكتب يُصدره، والمقاول لا يسجّل نفسه.
--  الفرق أن العميل مرتبط بمشروع واحد، والمقاول يعمل في عدة مشاريع —
--  فمفتاحه اسمه بعد التوحيد، لا معرّف مشروع.

alter table client_accounts add column if not exists kind text not null default 'client';

--  مفتاح المقاول: contractor:<الاسم بحروف كبيرة بلا مسافات زائدة>
create or replace function public.contractor_key(p_name text)
returns text language sql immutable as $$
  select 'contractor:' || upper(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g'))
$$;

create or replace function public.issue_contractor_account(p_name text)
returns table (out_username text, out_password text)
language plpgsql security definer set search_path = public as $$
declare
  u text; pw text; org uuid; tries int := 0; k text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  org := my_org();
  if org is null then raise exception 'لا يوجد مكتب مرتبط بحسابك'; end if;
  if my_role() not in ('owner','manager') then
    raise exception 'إصدار حسابات المقاولين لمالك المكتب أو مدير المشاريع فقط';
  end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'اكتب اسم المقاول أولًا'; end if;

  k := contractor_key(p_name);

  --  البادئة K تميّز حساب المقاول عن حساب العميل (C) بمجرد النظر
  loop
    tries := tries + 1;
    u := 'K';
    for i in 1..7 loop
      u := u || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from client_accounts ca where ca.username = u) or tries > 12;
  end loop;

  pw := '';
  for i in 1..10 loop
    pw := pw || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;

  insert into client_accounts (org_id, client_key, client_name, username, password_hash, created_by, kind)
  values (org, k, trim(p_name), u, crypt(pw, gen_salt('bf')), auth.uid(), 'contractor')
  on conflict (org_id, client_key) do update
    set username = excluded.username,
        password_hash = excluded.password_hash,
        client_name = excluded.client_name,
        kind = 'contractor',
        active = true,
        created_at = now(),
        created_by = auth.uid();

  return query select u, pw;
end $$;

/*  حساب المقاول الجاري عبر كل مشاريع المكتب.

    ما يُعاد عمدًا: تعاقده هو، ودفعاته هو، ومحتجزه هو، واسم المشروع.
    ما لا يُعاد أبدًا: قيمة عقد العميل، ولا تحصيلاته، ولا بنود المقايسة،
    ولا أي مقاول آخر. الحجب في الخادم لا في الواجهة — فلا يُلتف عليه.  */
create or replace function public.contractor_statement(p_org uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  out_rows jsonb := '[]'::jsonb;
  r record; mine jsonb; ids text[]; pays jsonb;
begin
  for r in select key, value from kv
            where org_id = p_org and key like 'client:%' loop

    select coalesce(jsonb_agg(c), '[]'::jsonb) into mine
      from jsonb_array_elements(coalesce(r.value->'contractors', '[]'::jsonb)) c
     where contractor_key(c->>'name') = p_key;

    if mine = '[]'::jsonb then continue; end if;

    select array_agg(c->>'id') into ids from jsonb_array_elements(mine) c;

    select coalesce(jsonb_agg(jsonb_build_object(
             'date',     e->>'date',
             'amount',   e->>'amount',
             'retained', e->>'retained',
             'phase',    e->>'phase',
             'note',     e->>'note')), '[]'::jsonb)
      into pays
      from jsonb_array_elements(coalesce(r.value->'expenses', '[]'::jsonb)) e
     where e->>'contractorId' = any(ids);

    out_rows := out_rows || jsonb_build_array(jsonb_build_object(
      'project',     coalesce(r.value->>'name', 'مشروع'),
      'address',     coalesce(r.value->>'address', ''),
      'contractors', mine,
      'payments',    pays));
  end loop;

  return out_rows;
end $$;

/*  دخول موحّد: عميل أو مقاول، بنفس النافذة.
    الدالة ترجع نوع الحساب فتعرف الواجهة أي شاشة تعرض.  */
create or replace function public.portal_login(p_username text, p_password text)
returns table (out_kind text, out_key text, out_name text, out_org_name text, out_payload jsonb)
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

  if rec.kind = 'contractor' then
    return query
      select 'contractor'::text, rec.client_key, rec.client_name,
             (select name from orgs where id = rec.org_id),
             contractor_statement(rec.org_id, rec.client_key);
  else
    /*  العميل يحتاج إعدادات المكتب (الإشراف والاحتياطي والضريبة ونسبة
        الربح) وإلا تعذّر حساب قيمة كل مرحلة عنده. تُرسل الإعدادات وحدها
        لا دفتر الأسعار ولا التكاليف — فلا يرى ما لا يخصّه.  */
    return query
      select 'client'::text, rec.client_key, rec.client_name,
             (select name from orgs where id = rec.org_id),
             jsonb_build_object(
               'client',   (select value from kv where org_id = rec.org_id and key = rec.client_key),
               'settings', (select value from kv where org_id = rec.org_id and key = 'settings:global'));
  end if;
end $$;

revoke all on function public.portal_login(text, text) from public;
grant execute on function public.portal_login(text, text) to anon, authenticated;

--  قائمة الحسابات المُصدَرة لمكتبك (بلا كلمات سر — لا وجود لها أصلًا)
create or replace function public.my_portal_accounts()
returns table (kind text, key text, name text, username text, active boolean,
               last_login_at timestamptz, login_count int)
language sql stable security definer set search_path = public as $$
  select ca.kind, ca.client_key, ca.client_name, ca.username, ca.active,
         ca.last_login_at, ca.login_count
    from client_accounts ca
   where ca.org_id = my_org()
   order by ca.kind, ca.client_name
$$;


-- ════════════════════════════════════════════════════════════════════════════
--  فحص الهجرة
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.storage_check()
returns table (البند text, الحالة text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select 'مساحة site-photos موجودة'::text,
    case when exists (select 1 from storage.buckets where id='site-photos') then '✅' else '❌' end
  union all select 'المساحة خاصة لا عامة',
    case when exists (select 1 from storage.buckets where id='site-photos' and public=false) then '✅' else '❌' end
  union all select 'سياسات المساحة الأربع',
    case when (select count(*) from pg_policies
               where schemaname='storage' and tablename='objects'
                 and policyname like 'photos_%') = 4 then '✅' else '❌' end
  union all select 'دالة إصدار حساب المقاول',
    case when exists (select 1 from pg_proc where proname='issue_contractor_account') then '✅' else '❌' end
  union all select 'دالة الدخول الموحّدة',
    case when exists (select 1 from pg_proc where proname='portal_login') then '✅' else '❌' end
  union all select 'كشف حساب المقاول',
    case when exists (select 1 from pg_proc where proname='contractor_statement') then '✅' else '❌' end;
end $$;

-- ============================================================================
--  بعد التشغيل تحقّق:   select * from storage_check();
-- ============================================================================
