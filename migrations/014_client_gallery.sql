-- ============================================================================
--  الهجرة ١٤ — معرض صور العميل
-- ============================================================================
--  شغّلها في: Supabase → SQL Editor → New query → Run.  آمنة للتكرار.
--
--  المشكلة التي تحلّها:
--  صور المواقع مخزّنة في مساحة خاصة تُقرأ بروابط موقّتة تحتاج جلسة
--  مستخدم من نفس المكتب. والعميل في بوابته ليس مستخدمًا مسجَّلًا —
--  فلا يستطيع رؤية أي صورة مهما رفع المكتب.
--
--  الحل: مساحة ثانية معلنة (project-gallery) للصور التي يختار المكتب
--  عرضها على العميل. الفصل مقصود:
--    site-photos     خاصة — توثيق داخلي، عناوين وتفاصيل لا تُنشر
--    project-gallery معلنة — ما ينتقيه المكتب لعرضه، ويعلم أنه معلن
--
--  أي صورة هنا يمكن لمن يملك رابطها فتحها. ولذلك لا تُرفع إليها إلا
--  اللقطات التي يرضى المكتب أن يراها العميل — والرفع للمكتب وحده.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-gallery', 'project-gallery', true, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  execute 'drop policy if exists "gallery_public_read" on storage.objects';
  execute 'drop policy if exists "gallery_write_own_org" on storage.objects';
  execute 'drop policy if exists "gallery_update_own_org" on storage.objects';
  execute 'drop policy if exists "gallery_delete_own_org" on storage.objects';

  --  القراءة معلنة: هذا هو الغرض من المساحة
  execute $p$create policy "gallery_public_read" on storage.objects for select
            using (bucket_id = 'project-gallery')$p$;

  --  الكتابة للمكتب صاحب المجلد وحده — أول جزء من المسار هو معرّفه
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'my_org') then
    execute $p$create policy "gallery_write_own_org" on storage.objects for insert
              with check (bucket_id = 'project-gallery'
                          and (storage.foldername(name))[1] = my_org()::text)$p$;
    execute $p$create policy "gallery_update_own_org" on storage.objects for update
              using (bucket_id = 'project-gallery'
                     and (storage.foldername(name))[1] = my_org()::text)$p$;
    execute $p$create policy "gallery_delete_own_org" on storage.objects for delete
              using (bucket_id = 'project-gallery'
                     and (storage.foldername(name))[1] = my_org()::text)$p$;
  end if;
exception when insufficient_privilege then
  raise notice 'أنشئ مساحة project-gallery يدويًا من Supabase ← Storage واجعلها Public';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  التقرير
-- ════════════════════════════════════════════════════════════════════════════
select 'مساحة معرض العميل'::text as البند,
       case when exists (select 1 from storage.buckets where id='project-gallery' and public)
            then '✅ جاهزة ومعلنة' else '❌ غير موجودة' end as الحالة
union all
select 'سياسات المعرض',
       (select count(*)::text from pg_policies
         where schemaname='storage' and tablename='objects'
           and policyname like 'gallery_%') || ' من 4';

-- ============================================================================
--  بعدها: افتح المشروع في الأداة ← «معرض العميل» ← ارفع اللقطات التي
--  تريد أن يراها العميل في بوابته.
-- ============================================================================
