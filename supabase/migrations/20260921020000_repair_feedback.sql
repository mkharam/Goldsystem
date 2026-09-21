-- تقييم الزبون بعد التسليم: نجوم 1–5 وتعليق اختياري، يُرسَل من صفحة التتبّع العامة.
--
-- الكتابة حصراً عبر دالة الحافة track (مفتاح الخدمة) بعد التحقق من رمز التذكرة وأنها
-- مسلّمة، وتقييم واحد لكل تذكرة (المفتاح الأساسي). لا سياسة كتابة للمتصفح إطلاقاً — حساب
-- موظف لا يقدر يؤلّف تقييماً. القراءة تتبع عزل الفروع: المدير العام للكل، غيره فرعه.
CREATE TABLE public.repair_feedback (
  ticket_id UUID PRIMARY KEY REFERENCES public.repair_tickets(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX repair_feedback_low_idx ON public.repair_feedback (created_at DESC) WHERE rating <= 2;

ALTER TABLE public.repair_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY feedback_read ON public.repair_feedback FOR SELECT TO authenticated
  USING (public.can_access_ticket(ticket_id::text));
GRANT SELECT ON public.repair_feedback TO authenticated;
GRANT ALL ON public.repair_feedback TO service_role;
