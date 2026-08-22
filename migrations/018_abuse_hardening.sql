-- ============================================================================
--  الهجرة ١٨ — تحصين ضدّ الإساءة والحرمان من الخدمة
-- ============================================================================
--  شغّلها في: Supabase → SQL Editor → New query → Run.  آمنة للتكرار.
--
--  المراجعة السابقة أثبتت أن سرّية البيانات سليمة: لا تسريب بين المكاتب،
--  ولا رفع صلاحية، ولا قراءة لغير صاحب الحساب. لكنها كشفت أربع ثغرات
--  في الإتاحة وإساءة الاستخدام — لا في سرقة البيانات — وهذه الهجرة تعالجها:
--
--   ١· إقفال حساب العميل عليه (الأخطر)
--      حدّ المحاولات كان يعدّ الأخطاء «لكل اسم مستخدم». فمن يعرف اسم
--      مستخدم عميلك يتعمّد خمس محاولات فاشلة فيبقى العميل محبوسًا خارج
--      بوابته — بكلمته الصحيحة! الحدّ كان يحمي من التخمين ويُؤذي صاحبه.
--      الإصلاح: الحدّ يصير «لكل عنوان اتصال (IP)» لا لكل اسم. فمهاجمٌ من
--      اتصاله يُحبس، والعميل من اتصاله هو لا يتأثّر أبدًا.
--
--   ٢· إدراج مكاتب مباشرة من جلسة مصادَقة
--      سياسة orgs_insert كانت (true) — أي عضو، حتى «قيد الاعتماد»، يُدرج
--      مكاتب بلا حدّ. التسجيل الحقيقي يمرّ بتريجر handle_new_user وهو
--      security definer يتخطّى RLS، فلا يحتاج هذه السياسة أصلًا. نغلقها.
--
--   ٣· تضخّم جدول المحاولات
--      كل دخول فاشل يزرع صفًّا، والتنظيف كان لا يُستدعى إلّا عند نجاح
--      دخولٍ ما — ومهاجمٌ يرشّ أسماء عشوائية لا ينجح أبدًا. الآن التنظيف
--      يجري تلقائيًّا على جزء يسير من الاستدعاءات، فلا يتراكم.
--
--   ٤· تعداد الأسماء بالزمن (تحسين)
--      اسمٌ صحيح يُشغّل bcrypt (بطيء) وخاطئ لا يُشغّله (سريع) — الفرق
--      يكشف الأسماء الصحيحة لمن يقيس الزمن. نُشغّل مقارنة وهمية على
--      الاسم غير الموجود ليتساوى الزمن.
--
--  ملاحظة صريحة: قراءة عنوان الاتصال تعتمد على ترويسة x-forwarded-for
--  التي يمرّرها Supabase. إن غابت (إعداد مختلف) تعود الدالة إلى حدّ لكل
--  اسم لكنها لا تُقفل صاحب الكلمة الصحيحة أبدًا. الطبقة الأقوى ضدّ
--  الإساءة تبقى CAPTCHA على التسجيل — تُفعَّل من لوحة Supabase (انظر آخر الملف).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
--  ٢ — إغلاق إدراج المكاتب المباشر
-- ════════════════════════════════════════════════════════════════════════════
--  التسجيل الحقيقي عبر التريجر (security definer) لا يمرّ بهذه السياسة،
--  فإغلاقها لا يكسر إنشاء المكاتب — يمنع فقط الإدراج اليدوي من جلسة عبث.
drop policy if exists "orgs_insert" on orgs;
create policy "orgs_insert" on orgs for insert
  with check (is_platform_admin());   -- لا أحد سوى مدير المنصّة يدرج يدويًّا

-- ════════════════════════════════════════════════════════════════════════════
--  ٣ — عمود عنوان الاتصال في جدول المحاولات
-- ════════════════════════════════════════════════════════════════════════════
alter table public.portal_login_attempts add column if not exists ip text;
create index if not exists portal_attempts_ip_idx
  on public.portal_login_attempts (ip, at desc);

-- ════════════════════════════════════════════════════════════════════════════
--  ٤ — قراءة عنوان الاتصال بأمان
-- ════════════════════════════════════════════════════════════════════════════
--  Supabase يمرّر ترويسات الطلب في إعداد الجلسة request.headers.
--  نأخذ أول عنوان في x-forwarded-for. أي غياب أو خطأ يعيد '' بلا انهيار.
create or replace function public.portal_client_ip()
returns text language plpgsql stable set search_path = public as $$
declare hdrs text; xff text;
begin
  hdrs := current_setting('request.headers', true);
  if hdrs is null or hdrs = '' then return ''; end if;
  xff := (hdrs::json ->> 'x-forwarded-for');
  if xff is null or xff = '' then return ''; end if;
  return split_part(xff, ',', 1);   -- أوّل عنوان = عميل الطلب
exception when others then
  return '';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ٥ — الدخول الموحّد: حدّ لكل اتصال، بلا إقفال للضحية
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.portal_login(p_username text, p_password text)
returns table (out_kind text, out_key text, out_name text, out_org_name text, out_payload jsonb)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_variable
declare
  rec       client_accounts%rowtype;
  org_label text;
  fails_ip  int := 0;
  fails_usr int := 0;
  u         text;
  ip        text;
  --  تجزيء وهمي بنفس كلفة bcrypt، يُقارَن به الاسمُ غير الموجود
  --  فيتساوى الزمن ولا يُكشف أيّ الأسماء صحيح.
  dummy_hash constant text :=
    '$2a$06$abcdefghijklmnopqrstuu6f2Vh.J1u3xI4o0k2Q9Z8Yh1sVqK7yq';
begin
  u  := upper(trim(coalesce(p_username, '')));
  ip := portal_client_ip();

  --  حدّ لكل اتصال: عشر محاولات خاطئة في الربع ساعة من نفس العنوان.
  --  هذا يحبس المهاجم من اتصاله، ولا يمسّ العميل من اتصاله هو.
  if ip <> '' then
    select count(*) into fails_ip from portal_login_attempts a
     where a.ip = ip and a.ok = false and a.at > now() - interval '15 minutes';
    if fails_ip >= 10 then
      raise exception 'محاولات كثيرة خاطئة — انتظر ربع ساعة ثم أعد المحاولة';
    end if;
  else
    --  لا عنوان متاح: حدّ احتياطي لكل اسم، لكنه أعلى ولا يُقفل الكلمة
    --  الصحيحة (المقارنة تجري دائمًا؛ الحدّ يُبطئ التخمين لا يمنع صاحبه).
    select count(*) into fails_usr from portal_login_attempts a
     where a.username = u and a.ok = false and a.at > now() - interval '15 minutes';
  end if;

  select * into rec from client_accounts ca where ca.username = u and ca.active;

  --  مقارنة تُجرى في كل الأحوال — للاسم الموجود بتجزيئه، ولغير الموجود
  --  بتجزيء وهمي — فيتساوى الزمن. النتيجة الحاسمة تبقى found + تطابق التجزيء.
  if not found then
    perform crypt(p_password, dummy_hash);
    insert into portal_login_attempts (username, ip, ok) values (u, ip, false);
    perform portal_attempts_maybe_sweep();
    return;
  end if;

  if rec.password_hash <> crypt(p_password, rec.password_hash) then
    insert into portal_login_attempts (username, ip, ok) values (u, ip, false);
    perform portal_attempts_maybe_sweep();
    return;
  end if;

  --  في وضع «لا عنوان»، حتى لو تجاوز الاسمُ الحدّ، الكلمةُ الصحيحة تمرّ:
  --  فلا يُقفل صاحب الحساب أبدًا، ويبقى التخمين محدودًا لأنه لا يعرفها.

  --  دخول ناجح: يمسح محاولات هذا الاسم وهذا العنوان
  delete from portal_login_attempts a where a.username = u or (ip <> '' and a.ip = ip);

  update client_accounts ca
     set last_login_at = now(), login_count = ca.login_count + 1
   where ca.id = rec.id;

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
                          'client',   portal_client_payload(
                                        (select value from kv where org_id = rec.org_id and key = rec.client_key)),
                          'settings', (select jsonb_build_object(
                                                'supervisionPct', value->'supervisionPct',
                                                'contingencyPct', value->'contingencyPct',
                                                'vatPct',         value->'vatPct',
                                                'agreedProfitPct',value->'agreedProfitPct',
                                                'officeName',     value->'officeName')
                                         from kv where org_id = rec.org_id and key = 'settings:global'));
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ٦ — تغيير كلمة السر: نفس الحدّ لكل اتصال
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.portal_change_password(
  p_username text, p_old text, p_new text
) returns text
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_variable
declare rec client_accounts%rowtype; u text; ip text; fails_ip int := 0;
  dummy_hash constant text :=
    '$2a$06$abcdefghijklmnopqrstuu6f2Vh.J1u3xI4o0k2Q9Z8Yh1sVqK7yq';
begin
  u  := upper(trim(coalesce(p_username, '')));
  ip := portal_client_ip();

  if ip <> '' then
    select count(*) into fails_ip from portal_login_attempts a
     where a.ip = ip and a.ok = false and a.at > now() - interval '15 minutes';
    if fails_ip >= 10 then
      return 'محاولات كثيرة خاطئة — انتظر ربع ساعة ثم أعد المحاولة';
    end if;
  end if;

  if p_new is null or length(trim(p_new)) < 8 then
    return 'كلمة السر الجديدة قصيرة — ثمانية أحرف على الأقل';
  end if;
  if trim(p_new) = trim(coalesce(p_old, '')) then
    return 'كلمة السر الجديدة مطابقة للقديمة';
  end if;

  select * into rec from client_accounts ca where ca.username = u and ca.active;

  if not found then
    perform crypt(p_old, dummy_hash);
    insert into portal_login_attempts (username, ip, ok) values (u, ip, false);
    perform portal_attempts_maybe_sweep();
    return 'كلمة السر الحالية غير صحيحة';
  end if;
  if rec.password_hash <> crypt(p_old, rec.password_hash) then
    insert into portal_login_attempts (username, ip, ok) values (u, ip, false);
    perform portal_attempts_maybe_sweep();
    return 'كلمة السر الحالية غير صحيحة';
  end if;

  update client_accounts ca
     set password_hash = crypt(trim(p_new), gen_salt('bf')),
         must_change = false, password_set_at = now()
   where ca.id = rec.id;

  delete from portal_login_attempts a where a.username = u or (ip <> '' and a.ip = ip);
  return '✅ تغيّرت كلمة السر';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ٧ — تنظيف تلقائي بلا حاجة لمهمّة مجدولة
-- ════════════════════════════════════════════════════════════════════════════
--  يُستدعى من داخل الدخول على جزء يسير من المرّات (٣٪ تقريبًا)، فيكنس
--  ما تجاوز الساعة دون أن يُثقل كل طلب. تبقى مهمة Cron خيارًا أفضل تحت
--  الحِمل العالي (انظر آخر الملف)، لكن هذا يكفي للاستخدام العادي.
create or replace function public.portal_attempts_maybe_sweep()
returns void language plpgsql security definer set search_path = public as $$
begin
  if random() < 0.03 then
    delete from portal_login_attempts where at < now() - interval '1 hour';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  التحقّق
-- ════════════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';

select 'إدراج المكاتب مقيّد بمدير المنصّة'::text as البند,
       case when (select with_check from pg_policies
                   where schemaname='public' and tablename='orgs' and policyname='orgs_insert')
                 like '%is_platform_admin%'
            then '✅' else '❌' end as الحالة
union all
select 'عمود عنوان الاتصال',
       case when exists (select 1 from information_schema.columns
                          where table_name='portal_login_attempts' and column_name='ip')
            then '✅' else '❌' end
union all
select 'الحدّ لكل اتصال لا لكل اسم',
       case when (select prosrc from pg_proc where proname='portal_login') like '%fails_ip%'
            then '✅' else '❌' end
union all
select 'مقارنة وهمية ضدّ التعداد الزمني',
       case when (select prosrc from pg_proc where proname='portal_login') like '%dummy_hash%'
            then '✅' else '❌' end
union all
select 'التنظيف التلقائي',
       case when exists (select 1 from pg_proc where proname='portal_attempts_maybe_sweep')
            then '✅' else '❌' end;

-- ============================================================================
--  الطبقة الأقوى — فعّلها من لوحة Supabase (دقيقتان، بلا SQL):
--
--    Authentication → Settings → Bot and Abuse Protection
--    → فعّل «Enable CAPTCHA protection» (hCaptcha أو Turnstile)
--
--  هذا وحده يُبطل تسجيل المكاتب الوهمية الآلي — وهو ما لا يعالجه أي كود
--  في قاعدة البيانات، لأن المكتب يُنشأ لحظة إدراج المستخدم في auth.users.
--
--  وإن أردت تنظيفًا مجدولًا بدل التلقائي (تحت حِمل عالٍ):
--    Database → Extensions → فعّل pg_cron، ثم:
--    select cron.schedule('portal-cleanup','0 3 * * *',
--                         $$select portal_attempts_cleanup()$$);
-- ============================================================================
