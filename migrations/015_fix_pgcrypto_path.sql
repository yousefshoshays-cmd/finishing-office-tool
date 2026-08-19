-- ============================================================================
--  الهجرة ١٥ — إصلاح: function gen_salt(unknown) does not exist
-- ============================================================================
--  شغّلها في: Supabase → SQL Editor → New query → Run.  آمنة للتكرار.
--
--  سبب العطل بالضبط:
--  دوال التشفير (crypt و gen_salt) تأتي من امتداد pgcrypto، وSupabase
--  يثبّته في مخطط اسمه extensions لا في public. ودوال البوابة عندنا
--  مكتوبة بـ set search_path = public — وهو قيد أمني مقصود يمنع خداع
--  الدالة بمخطط مزروع، لكنه هنا حجب pgcrypto عنها.
--
--  فكانت النتيجة محيّرة: الهجرة تُركَّب بنجاح (لأن جسم الدالة لا يُفحص
--  عند الإنشاء)، ثم تفشل عند أول استعمال برسالة «gen_salt غير موجودة».
--
--  الإصلاح: توسيع مسار البحث ليشمل extensions أيضًا — بلا فتحه على
--  مصراعيه. مخطّطان محدّدان فقط، والقيد الأمني باقٍ.
-- ============================================================================

--  إن كان الامتداد غير مثبَّت أصلًا، ثبّته حيث يسمح المشروع
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    begin
      execute 'create extension pgcrypto with schema extensions';
    exception when others then
      execute 'create extension pgcrypto';
    end;
  end if;
end $$;

--  توسيع مسار البحث لكل دالة تستعمل التشفير، إن كانت موجودة
do $$
declare
  r record;
  targets text[] := array[
    'issue_portal_account', 'issue_client_account', 'issue_contractor_account',
    'reset_client_password', 'revoke_client_account', 'portal_login',
    'client_portal_login', 'my_portal_accounts', 'contractor_statement'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(targets)
  loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  اختبار ذاتي: هل صار التشفير يعمل من داخل دالة بنفس القيد؟
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.portal_crypto_selftest()
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare h text;
begin
  h := crypt('كلمة-اختبار', gen_salt('bf'));
  if h = crypt('كلمة-اختبار', h) and h <> crypt('كلمة-خاطئة', h) then
    return '✅ التشفير يعمل — أعد المحاولة من الأداة الآن';
  end if;
  return '❌ التشفير لا يتصرّف كما يجب';
exception when others then
  return '❌ ' || SQLERRM;
end $$;

--  تحديث فهرس الخادم بعد تغيير الدوال
notify pgrst, 'reload schema';

select 'امتداد pgcrypto'::text as البند,
       coalesce((select 'مثبَّت في مخطط: ' || n.nspname
                   from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                  where e.extname = 'pgcrypto'), '❌ غير مثبَّت') as الحالة
union all
select 'دوال البوابة المُصلَحة',
       (select count(*)::text from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proconfig::text like '%extensions%') || ' دالة'
union all
select 'اختبار التشفير', portal_crypto_selftest();

-- ============================================================================
--  المتوقّع: «✅ التشفير يعمل». بعدها أصدر حساب العميل أو المقاول من
--  الأداة مباشرة — بلا إعادة تشغيل أي ملف آخر.
-- ============================================================================
