-- =====================================================================
-- فتح الوصول من المتصفح عبر RLS
--
-- كان التطبيق يعمل بخادم Next.js يحمل مفتاح service_role، فكانت RLS مانعة
-- بالكامل. النسخة المستضافة على GitHub Pages بلا خادم: المتصفح يتصل بـ
-- Supabase مباشرة بالمفتاح العلني، فصارت RLS هي الحارس الوحيد لا طبقة ثانية.
--
-- القاعدة: كل صلاحية مشروطة بوجود صف موظف **فعّال** مرتبط بالمستخدم الحالي.
-- من لا صف له — أو أُوقف — لا يرى شيئاً مهما كان لديه حساب في Auth.
-- =====================================================================

-- ربط الموظف بحساب Supabase Auth في مشروع الصيانة نفسه.
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS staff_auth_user_idx ON public.staff (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- كلمات المرور صارت في Supabase Auth؛ لا داعي لتجزئتنا الخاصة.
ALTER TABLE public.staff DROP COLUMN IF EXISTS password_hash;

/**
 * معرّف الموظف الحالي، أو NULL لغير المصرّح له.
 *
 * SECURITY DEFINER لأن السياسات نفسها تقرأ جدول staff — بدونها يقع تكرار
 * لا نهائي: سياسة staff تستدعي دالة تقرأ staff فتستدعي السياسة من جديد.
 */
CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.staff WHERE auth_user_id = auth.uid() AND is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff WHERE auth_user_id = auth.uid() AND is_active);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE auth_user_id = auth.uid() AND is_active AND role IN ('admin', 'manager')
  );
$$;

-- السحب من anon صراحةً لا من PUBLIC وحده: Supabase يمنح anon صلاحية EXECUTE
-- مباشرةً عبر default privileges، فلا يمسّها السحب من PUBLIC. هذه الدوال لا
-- تسرّب شيئاً لـ anon (تعيد false لأن auth.uid() فارغ) لكن لا داعي لكشفها.
REVOKE ALL ON FUNCTION public.current_staff_id(), public.is_staff(), public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_id(), public.is_staff(), public.is_admin() TO authenticated;

-- ---------------------------------------------------------------------
-- الصلاحيات الأساسية: authenticated فقط، و anon لا شيء إطلاقاً.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
  public.branches, public.staff, public.customers, public.repair_tickets,
  public.repair_photos, public.repair_status_history, public.repair_notifications
TO authenticated;
GRANT SELECT ON public.settings TO authenticated;
GRANT UPDATE ON public.settings TO authenticated;

-- ---------------------------------------------------------------------
-- السياسات
-- ---------------------------------------------------------------------

-- الفروع: الجميع يقرأ، والمديرون وحدهم يعدّلون (المزامنة تمرّ عبر دالة حافة).
CREATE POLICY branches_read ON public.branches FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY branches_write ON public.branches FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY branches_update ON public.branches FOR UPDATE TO authenticated USING (public.is_admin());

-- الموظفون: الأسماء تظهر في السجل والتذاكر فيقرأها الجميع، لكن لا أحد يعدّل
-- صفّه ليمنح نفسه دوراً أعلى — التعديل للمديرين، وكلٌّ يعدّل اسمه فقط.
CREATE POLICY staff_read ON public.staff FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY staff_admin_insert ON public.staff FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY staff_admin_update ON public.staff FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- الزبائن والتذاكر وما يتبعها: أي موظف فعّال.
CREATE POLICY customers_all ON public.customers FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY tickets_read ON public.repair_tickets FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY tickets_insert ON public.repair_tickets FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY tickets_update ON public.repair_tickets FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY photos_all ON public.repair_photos FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- السجل يُكتب ولا يُعدّل: أثر التغييرات لا معنى له إن أمكن تحريره لاحقاً.
CREATE POLICY history_read ON public.repair_status_history FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY history_insert ON public.repair_status_history FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() AND changed_by = public.current_staff_id());

CREATE POLICY notifications_read ON public.repair_notifications FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY notifications_insert ON public.repair_notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() AND sent_by = public.current_staff_id());

CREATE POLICY settings_read ON public.settings FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY settings_update ON public.settings FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ticket_counters بلا سياسات ولا صلاحيات: لا يُلمس إلا عبر next_ticket_number.
GRANT EXECUTE ON FUNCTION public.next_ticket_number(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- تخزين الصور
-- الحاوية تبقى خاصة؛ الموظف يرفع ويقرأ، وصفحة التتبّع العامة تمرّ عبر دالة
-- حافة توقّع الروابط بدل فتح الحاوية للجميع.
-- ---------------------------------------------------------------------
CREATE POLICY repair_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'repair-photos' AND public.is_staff());
CREATE POLICY repair_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'repair-photos' AND public.is_staff());
CREATE POLICY repair_photos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'repair-photos' AND public.is_staff());
