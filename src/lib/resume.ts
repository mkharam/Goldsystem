// العودة لنفس المكان بعد الخروج من التطبيق.
//
// الآيفون يُغلق تطبيقات الويب في الخلفية ليوفّر الذاكرة: الموظف يفتح واتساب أو الكاميرا،
// يعود، فيجد التطبيق بدأ من الصفحة الرئيسية وضاع ما كان يفعله. نحفظ آخر صفحة (مع
// تبويبها وبحثها — كلها في الرابط) ونعود إليها عند فتح التطبيق من جديد.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const KEY = "repair.lastRoute";
// بعد هذه المدة نعتبره فتحاً جديداً لا عودة من تطبيق آخر.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
// صفحات لا نعود إليها: الدخول، متابعة الزبون (رابط عام)، والإيصال بعد طباعته.
const SKIP = [/^\/login/, /^\/track\//, /\/receipt/, /^\/receipts/];

export function ResumeRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);

  // مرة واحدة عند فتح التطبيق: إن بدأ من الرئيسية وكان آخر مكان غيرها، نعود إليه.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (location.pathname !== "/" || location.search) return;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { to: string; at: number } | null;
      if (saved && Date.now() - saved.at < MAX_AGE_MS && saved.to !== "/") navigate(saved.to, { replace: true });
    } catch {
      /* تخزين غير متاح */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // كل تنقّل يُحفظ (بعد محاولة الاستعادة حتى لا نمحو الوجهة قبل الوصول إليها).
  useEffect(() => {
    if (!restored.current) return;
    const to = location.pathname + location.search;
    if (SKIP.some((re) => re.test(location.pathname))) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ to, at: Date.now() }));
    } catch {
      /* تخزين غير متاح */
    }
  }, [location.pathname, location.search]);

  return null;
}
