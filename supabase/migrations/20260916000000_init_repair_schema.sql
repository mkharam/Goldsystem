-- =====================================================================
-- تطبيق متابعة الصيانة — المخطط الأولي
--
-- قاعدة بيانات مستقلة تماماً عن نظام المخزون. ما يأتي من المخزون (الفروع،
-- الموظفون، الزبائن، القطع) يُخزَّن هنا كنسخة محلية مع معرّف المصدر، حتى يبقى
-- التطبيق عاملاً بالكامل حين تنقطع واجهة المخزون.
--
-- لا يتصل المتصفح بـ Supabase مباشرة: كل شيء يمرّ عبر خادم Next.js بمفتاح
-- service_role. لذلك سياسات RLS هنا مانعة بالكامل لـ anon و authenticated،
-- وهي طبقة دفاع ثانية لا الطبقة الأولى.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- أنواع
-- ---------------------------------------------------------------------
CREATE TYPE public.repair_status AS ENUM (
  'received',     -- مستلمة
  'in_progress',  -- قيد التنفيذ
  'ready',        -- جاهزة للتسليم
  'delivered',    -- مسلّمة
  'cancelled'     -- ملغاة
);

CREATE TYPE public.item_source AS ENUM ('inventory', 'manual');

CREATE TYPE public.photo_stage AS ENUM ('intake', 'progress', 'delivery');

CREATE TYPE public.staff_role AS ENUM ('admin', 'manager', 'employee');

-- ---------------------------------------------------------------------
-- الفروع — نسخة محلية من فروع المخزون
-- ---------------------------------------------------------------------
CREATE TABLE public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_branch_id UUID UNIQUE,   -- المعرّف في نظام المخزون
  name TEXT NOT NULL,
  code TEXT,                          -- يدخل في رقم التذكرة
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- الموظفون — نسخة محلية، مع تجزئة كلمة المرور للدخول حين ينقطع المخزون
-- ---------------------------------------------------------------------
CREATE TABLE public.staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_staff_id UUID UNIQUE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role public.staff_role NOT NULL DEFAULT 'employee',
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  -- تُكتب عند أول دخول ناجح عبر المخزون، وتُستخدم للدخول دون اتصال لاحقاً.
  -- لا تُنشأ هنا أبداً: من لم يدخل عبر المخزون مرة واحدة لا يستطيع الدخول دون اتصال.
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- الزبائن — قد يكون مرتبطاً بزبون في المخزون أو محلياً بالكامل
-- ---------------------------------------------------------------------
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_customer_id UUID,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- البحث بالهاتف هو المدخل الأساسي لفتح التذكرة، وبآخر الأرقام لتفادي اختلاف الصيغة.
CREATE INDEX customers_phone_idx ON public.customers (phone);
CREATE INDEX customers_phone_tail_idx ON public.customers (RIGHT(regexp_replace(phone, '\D', '', 'g'), 6));
CREATE INDEX customers_inventory_id_idx ON public.customers (inventory_customer_id) WHERE inventory_customer_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- تذاكر الصيانة
-- ---------------------------------------------------------------------
CREATE TABLE public.repair_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE,

  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  received_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.staff(id) ON DELETE SET NULL,

  -- مصدر بيانات القطعة: من المخزون بالكود، أو إدخال يدوي حين تعذّر ذلك
  item_source public.item_source NOT NULL DEFAULT 'manual',
  inventory_product_id UUID,
  item_code TEXT,
  item_name TEXT NOT NULL,
  item_type TEXT,
  karat TEXT,
  -- الوزن عند الاستلام: أساس فحص الوزن عند التسليم
  weight_in_grams NUMERIC(10,3),
  weight_out_grams NUMERIC(10,3),
  weight_checked_at TIMESTAMPTZ,
  weight_variance_accepted_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  weight_variance_note TEXT,

  problem_description TEXT NOT NULL,
  work_done TEXT,
  estimated_cost NUMERIC(12,2),
  final_cost NUMERIC(12,2),

  status public.repair_status NOT NULL DEFAULT 'received',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promised_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  delivered_to_name TEXT,

  -- رمز التتبّع العام: يدخل في رمز QR على الإيصال ويفتح صفحة التتبّع بلا تسجيل دخول.
  -- عشوائي وغير قابل للتخمين، ومنفصل عن id حتى لا نكشف المفاتيح الداخلية.
  tracking_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX repair_tickets_status_idx ON public.repair_tickets (status);
CREATE INDEX repair_tickets_branch_idx ON public.repair_tickets (branch_id);
CREATE INDEX repair_tickets_customer_idx ON public.repair_tickets (customer_id);
CREATE INDEX repair_tickets_number_idx ON public.repair_tickets (ticket_number);
-- لوحة المتأخّرات تسأل عن المفتوحة التي فات موعدها — فهرس جزئي يخدمها وحدها.
CREATE INDEX repair_tickets_overdue_idx ON public.repair_tickets (promised_at)
  WHERE status IN ('received', 'in_progress', 'ready');

-- ---------------------------------------------------------------------
-- صور التذكرة
-- ---------------------------------------------------------------------
CREATE TABLE public.repair_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.repair_tickets(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  stage public.photo_stage NOT NULL DEFAULT 'intake',
  caption TEXT,
  -- الصور الداخلية (أثناء العمل) لا تظهر لصفحة التتبّع العامة افتراضياً.
  is_public BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX repair_photos_ticket_idx ON public.repair_photos (ticket_id);

-- ---------------------------------------------------------------------
-- سجل تغيّر الحالة — أثر كامل لمن غيّر ماذا ومتى
-- ---------------------------------------------------------------------
CREATE TABLE public.repair_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.repair_tickets(id) ON DELETE CASCADE,
  from_status public.repair_status,
  to_status public.repair_status NOT NULL,
  note TEXT,
  changed_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX repair_status_history_ticket_idx ON public.repair_status_history (ticket_id, created_at DESC);

-- ---------------------------------------------------------------------
-- سجل إشعارات واتساب
-- زر wa.me يفتح واتساب على جهاز الموظف؛ لا نرسل شيئاً آلياً، فهذا سجل
-- "أُبلغ الزبون" لا سجل تسليم مضمون.
-- ---------------------------------------------------------------------
CREATE TABLE public.repair_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.repair_tickets(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  phone TEXT,
  message_preview TEXT,
  sent_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX repair_notifications_ticket_idx ON public.repair_notifications (ticket_id, created_at DESC);

-- ---------------------------------------------------------------------
-- الإعدادات (مفتاح/قيمة)
-- ---------------------------------------------------------------------
CREATE TABLE public.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.settings (key, value, description) VALUES
  ('weight_tolerance_grams', '0.05', 'الفرق المسموح بين وزن الاستلام ووزن التسليم قبل رفع تنبيه'),
  ('default_turnaround_days', '3', 'عدد الأيام الافتراضي لتحديد موعد التسليم عند فتح التذكرة'),
  ('shop_name', 'مجوهرات', 'الاسم الظاهر على الإيصال وصفحة التتبّع'),
  ('receipt_footer', 'يرجى الاحتفاظ بهذا الإيصال لاستلام القطعة', 'نص أسفل إيصال الصيانة');

-- ---------------------------------------------------------------------
-- ترقيم التذاكر: R-<سنة>-<كود الفرع>-<تسلسل>
-- التسلسل يبدأ من جديد كل سنة ولكل فرع، ليبقى الرقم قصيراً ومقروءاً على الإيصال.
-- ---------------------------------------------------------------------
CREATE TABLE public.ticket_counters (
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  year INT NOT NULL,
  last_seq INT NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, year)
);

CREATE OR REPLACE FUNCTION public.next_ticket_number(p_branch_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM now())::INT;
  v_seq INT;
  v_code TEXT;
BEGIN
  -- UPSERT ذرّي: يمنع تكرار الرقم حين يفتح فرعان تذكرتين في اللحظة نفسها.
  INSERT INTO public.ticket_counters (branch_id, year, last_seq)
  VALUES (p_branch_id, v_year, 1)
  ON CONFLICT (branch_id, year)
  DO UPDATE SET last_seq = public.ticket_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  SELECT COALESCE(NULLIF(code, ''), '00') INTO v_code FROM public.branches WHERE id = p_branch_id;

  RETURN 'R-' || to_char(v_year % 100, 'FM00') || '-' || v_code || '-' || to_char(v_seq, 'FM0000');
END;
$$;

-- ---------------------------------------------------------------------
-- محفّزات
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER repair_tickets_touch BEFORE UPDATE ON public.repair_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER customers_touch BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- الطوابع الزمنية للحالات تُشتق من الحالة نفسها، حتى لا تتناقض مع السجل إن نسي
-- مسار في التطبيق ضبطها.
CREATE OR REPLACE FUNCTION public.stamp_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'ready' AND NEW.ready_at IS NULL THEN NEW.ready_at = now(); END IF;
    IF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN NEW.delivered_at = now(); END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at = now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER repair_tickets_stamp_status BEFORE UPDATE ON public.repair_tickets
  FOR EACH ROW EXECUTE FUNCTION public.stamp_status_change();

-- ---------------------------------------------------------------------
-- RLS — مانعة بالكامل. الوصول الوحيد عبر service_role من خادم Next.js.
-- ---------------------------------------------------------------------
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_counters ENABLE ROW LEVEL SECURITY;

-- لا سياسات = لا صفوف لأي دور غير service_role (الذي يتجاوز RLS أصلاً).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ---------------------------------------------------------------------
-- تخزين الصور
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('repair-photos', 'repair-photos', false)
ON CONFLICT (id) DO NOTHING;
