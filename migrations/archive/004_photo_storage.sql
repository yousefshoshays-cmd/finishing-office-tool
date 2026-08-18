-- ============================================================================
--  المرحلة ٥ — مساحة تخزين صور الموقع
-- ============================================================================
--  شغّله في: Supabase → SQL Editor → New query → لصق → Run
--  آمن للتكرار.
--
--  لماذا مساحة خاصة لا عامة؟ صور مواقع عملائك ليست محتوى عامًا — تحوي
--  عناوين وتفاصيل شققهم. التطبيق يولّد روابط موقّتة صالحة ساعة واحدة.
-- ============================================================================

-- ---------- إنشاء المساحة ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-photos', 'site-photos',
  false,                                   -- خاصة: لا وصول بدون رابط موقّع
  10485760,                                -- 10 ميجابايت للملف الواحد
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- الصلاحيات ----------
--  نفس منطق بقية النظام: الأعضاء المعتمدون فقط. الدور يأتي من
--  جدول profiles على الخادم، لا مما يدّعيه المتصفح.

drop policy if exists "approved read photos"   on storage.objects;
drop policy if exists "approved upload photos" on storage.objects;
drop policy if exists "approved update photos" on storage.objects;
drop policy if exists "owners delete photos"   on storage.objects;

create policy "approved read photos" on storage.objects for select using (
  bucket_id = 'site-photos'
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer'))
);

create policy "approved upload photos" on storage.objects for insert with check (
  bucket_id = 'site-photos'
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer'))
);

create policy "approved update photos" on storage.objects for update using (
  bucket_id = 'site-photos'
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer'))
);

-- الحذف أضيق: المهندس يرفع ويصحّح، لكن محو التوثيق قرار إداري.
-- صور الموقع دليل يُحتكم إليه عند الخلاف مع العميل أو المقاول.
create policy "owners delete photos" on storage.objects for delete using (
  bucket_id = 'site-photos'
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager'))
);

-- ---------- التحقق ----------
select
  (select count(*) from storage.buckets where id = 'site-photos')                        as المساحة_موجودة,
  (select public from storage.buckets where id = 'site-photos')                          as عامة_يجب_أن_تكون_false,
  (select count(*) from pg_policies
     where tablename = 'objects' and policyname like '%photos%')                          as عدد_السياسات;
