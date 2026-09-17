-- =====================================================================
-- سدّ ثغرة: next_ticket_number كانت قابلة للاستدعاء من anon
--
-- الهجرة الأولى سحبت الصلاحيات من anon و authenticated مباشرة، لكن Postgres
-- يمنح EXECUTE على الدوال لـ PUBLIC افتراضياً والدوران يرثانه منه — فبقي
-- /rest/v1/rpc/next_ticket_number مفتوحاً لأي زائر، وهي SECURITY DEFINER
-- فتتجاوز RLS على ticket_counters ويمكن استهلاك تسلسل أرقام التذاكر بها.
--
-- الهجرة الأولى صُحّحت أيضاً لتركيب جديد نظيف؛ هذه للمشاريع التي طبّقتها قبل
-- التصحيح. آمنة التكرار.
-- =====================================================================

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- search_path متغيّر داخل دالة محفّز يفتح باب انتحال الجداول عبر schema مسبوق
-- في المسار؛ نثبّته كما هو مثبّت أصلاً في next_ticket_number.
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.stamp_status_change() SET search_path = public;
