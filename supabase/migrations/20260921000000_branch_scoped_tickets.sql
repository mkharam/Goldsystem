-- =====================================================================
-- عزل التذاكر بالفرع
--
-- المدير العام (role = 'admin') يرى كل الفروع. ما عداه (مشرف أو موظف) لا يرى ولا
-- يكتب إلا تذاكر فرعه، وهو مفروض في RLS لا في الواجهة وحدها: المتصفح يتصل
-- بقاعدة البيانات مباشرة، فأي إخفاء في الواجهة يُتجاوز بطلب واحد.
--
-- موظف بلا فرع مرتبط لا يرى أي تذكرة (الأقل صلاحية عند الشك).
-- الزبائن والفروع والموظفون تبقى مقروءة لكل موظف فعّال كما كانت.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.current_branch_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM public.staff WHERE auth_user_id = auth.uid() AND is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff WHERE auth_user_id = auth.uid() AND is_active AND role = 'admin');
$$;

-- هل يحق للمستخدم الحالي لمس تذاكر هذا الفرع؟
CREATE OR REPLACE FUNCTION public.can_access_branch(p_branch UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin()
      OR (public.is_staff() AND p_branch IS NOT NULL AND p_branch = public.current_branch_id());
$$;

-- للتذاكر التابعة (صور/سجل/إشعارات) ولمسارات التخزين: المعرّف نصاً حتى لا يفشل
-- التحويل إن كان اسم الملف غير UUID.
CREATE OR REPLACE FUNCTION public.can_access_ticket(p_ticket TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.repair_tickets t
    WHERE t.id::text = p_ticket AND public.can_access_branch(t.branch_id)
  );
$$;

REVOKE ALL ON FUNCTION public.current_branch_id(), public.is_super_admin(),
  public.can_access_branch(UUID), public.can_access_ticket(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_branch_id(), public.is_super_admin(),
  public.can_access_branch(UUID), public.can_access_ticket(TEXT) TO authenticated;

-- التذاكر
DROP POLICY IF EXISTS tickets_read ON public.repair_tickets;
DROP POLICY IF EXISTS tickets_insert ON public.repair_tickets;
DROP POLICY IF EXISTS tickets_update ON public.repair_tickets;
CREATE POLICY tickets_read ON public.repair_tickets FOR SELECT TO authenticated
  USING (public.can_access_branch(branch_id));
CREATE POLICY tickets_insert ON public.repair_tickets FOR INSERT TO authenticated
  WITH CHECK (public.can_access_branch(branch_id));
-- WITH CHECK يمنع نقل تذكرة إلى فرع آخر بتعديل branch_id.
CREATE POLICY tickets_update ON public.repair_tickets FOR UPDATE TO authenticated
  USING (public.can_access_branch(branch_id)) WITH CHECK (public.can_access_branch(branch_id));

-- الصور
DROP POLICY IF EXISTS photos_all ON public.repair_photos;
CREATE POLICY photos_all ON public.repair_photos FOR ALL TO authenticated
  USING (public.can_access_ticket(ticket_id::text)) WITH CHECK (public.can_access_ticket(ticket_id::text));

-- سجل الحالات والإشعارات
DROP POLICY IF EXISTS history_read ON public.repair_status_history;
DROP POLICY IF EXISTS history_insert ON public.repair_status_history;
CREATE POLICY history_read ON public.repair_status_history FOR SELECT TO authenticated
  USING (public.can_access_ticket(ticket_id::text));
CREATE POLICY history_insert ON public.repair_status_history FOR INSERT TO authenticated
  WITH CHECK (public.can_access_ticket(ticket_id::text) AND changed_by = public.current_staff_id());

DROP POLICY IF EXISTS notifications_read ON public.repair_notifications;
DROP POLICY IF EXISTS notifications_insert ON public.repair_notifications;
CREATE POLICY notifications_read ON public.repair_notifications FOR SELECT TO authenticated
  USING (public.can_access_ticket(ticket_id::text));
CREATE POLICY notifications_insert ON public.repair_notifications FOR INSERT TO authenticated
  WITH CHECK (public.can_access_ticket(ticket_id::text) AND sent_by = public.current_staff_id());

-- ملفات الصور: أول جزء من المسار هو معرّف التذكرة.
DROP POLICY IF EXISTS repair_photos_read ON storage.objects;
DROP POLICY IF EXISTS repair_photos_insert ON storage.objects;
DROP POLICY IF EXISTS repair_photos_update ON storage.objects;
CREATE POLICY repair_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'repair-photos' AND public.can_access_ticket((storage.foldername(name))[1]));
CREATE POLICY repair_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'repair-photos' AND public.can_access_ticket((storage.foldername(name))[1]));
CREATE POLICY repair_photos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'repair-photos' AND public.can_access_ticket((storage.foldername(name))[1]));
