-- ============================================================================
--  فحص تشخيصي — لماذا تقول الأداة إن دوال البوابة غير موجودة؟
-- ============================================================================
--  شغّله في: Supabase → SQL Editor → New query → Run
--  لا يُنشئ شيئًا ولا يحذف شيئًا. يقرأ فقط، ويصلح فهرس الخادم في آخره.
--
--  اقرأ النتيجة سطرًا سطرًا وأرسلها كما هي.
-- ============================================================================

-- ── ١· أي مشروع أنت فيه الآن؟ ──
--  قارن هذا الاسم بما يظهر في: الأداة ← الإعدادات ← حالة النظام ←
--  «مشروع Supabase المرتبط». إن اختلفا فقد شغّلت الهجرة في مشروع
--  والأداة تخاطب مشروعًا آخر — وهذا وحده يفسّر كل شيء.
select 'قاعدة البيانات الحالية' as البند, current_database() as القيمة
union all
select 'المخطط الافتراضي', current_schema();

-- ── ٢· أي دوال بوابة موجودة فعلًا؟ ──
--  الجدول يعرض اسم الدالة ومعاملاتها. لو ظهرت الدالة باسم صحيح لكن
--  بمعاملات مختلفة، فالخادم لن يجدها حين تناديها الأداة.
select p.proname                                as الدالة,
       pg_get_function_identity_arguments(p.oid) as المعاملات,
       case when p.prosecdef then 'security definer' else '—' end as الصلاحية
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('issue_client_account','reset_client_password',
                     'revoke_client_account','client_portal_login',
                     'issue_contractor_account','portal_login',
                     'contractor_statement','contractor_key',
                     'my_portal_accounts','portal_check','storage_check',
                     'org_client_count','org_client_limit','can_add_client')
 order by 1;

-- ── ٣· الجداول والمساحة ──
select 'جدول client_accounts' as البند,
       case when to_regclass('public.client_accounts') is not null then '✅ موجود' else '❌ مفقود — شغّل 010' end as الحالة
union all
select 'عمود kind في الجدول',
       case when exists (select 1 from information_schema.columns
                          where table_name='client_accounts' and column_name='kind')
            then '✅ موجود' else '❌ مفقود — شغّل 011' end
union all
select 'مساحة site-photos',
       case when exists (select 1 from storage.buckets where id='site-photos')
            then '✅ موجودة' else '❌ مفقودة — شغّل 011' end
union all
select 'سياسات مساحة الصور',
       coalesce((select count(*)::text from pg_policies
                  where schemaname='storage' and tablename='objects'
                    and policyname like 'photos_%'), '0') || ' من 4';

-- ── ٤· صلاحية التنفيذ ──
--  الدالة قد تكون موجودة لكن بلا إذن تنفيذ لدور المستخدم المسجَّل،
--  فيردّ الخادم بخطأ يبدو وكأنها غير موجودة.
select p.proname as الدالة,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as ينفّذها_المستخدم_المسجَّل,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as ينفّذها_الزائر
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('issue_client_account','issue_contractor_account','portal_login')
 order by 1;

-- ── ٥· تحديث فهرس الخادم ──
--  Supabase يقرأ الدوال من فهرس داخلي (PostgREST schema cache). بعد
--  تشغيل هجرة جديدة قد يبقى الفهرس قديمًا دقائق أو حتى لا يتحدّث،
--  فتظهر الدالة في قاعدة البيانات ولا يجدها التطبيق. هذا السطر يجبره
--  على إعادة القراءة فورًا.
notify pgrst, 'reload schema';

select 'تم إرسال أمر تحديث الفهرس' as النتيجة,
       'انتظر ١٠ ثوانٍ ثم أعد المحاولة من الأداة' as الخطوة_التالية;

-- ============================================================================
--  إن ظهرت كل الأسطر ✅ ومع ذلك لم تعمل الأداة، فالمشكلة في المشروع
--  المرتبط لا في قاعدة البيانات — راجع البند ١.
-- ============================================================================
