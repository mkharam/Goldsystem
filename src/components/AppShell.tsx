import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";
import { useTheme } from "@/lib/theme";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.4 : 2}>
      <path d="M4 11.5 12 4l8 7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-5a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5h3a1 1 0 0 0 1-1v-9"
        stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.4 : 2}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" stroke="currentColor" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth={2.6}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({
  children,
  inventoryDown,
}: {
  children: React.ReactNode;
  inventoryDown?: boolean;
}) {
  const { staff, signOut } = useAuth();
  const { pathname } = useLocation();

  const onHome = pathname === "/";
  const onNew = pathname === "/tickets/new";
  const onCalendar = pathname === "/calendar";
  const [theme, toggleTheme] = useTheme();

  return (
    <div className={`min-h-dvh pb-32 ${theme === "dark" ? "theme-dark" : ""}`}>
      <header className="brand-surface sticky top-0 z-20 text-white shadow-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={34} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gold-100">{staff?.full_name}</p>
              {inventoryDown && (
                // الموظف يجب أن يعرف أن التعبئة التلقائية معطّلة قبل أن يبحث بالكود
                // ويظن أن القطعة غير موجودة.
                <p className="flex items-center gap-1 truncate text-xs text-gold-300/80">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
                  المخزون غير متصل — الإدخال يدوي
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          {/* الوضع الداكن/الفاتح — يُحفظ على هذا الجهاز. */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold-500/30 text-gold-200 transition active:scale-90 hover:bg-white/10"
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth={2}>
                <circle cx="12" cy="12" r="4.2" stroke="currentColor" />
                <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" stroke="currentColor" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth={2}>
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" stroke="currentColor" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="shrink-0 rounded-lg border border-gold-500/30 px-3 py-1.5 text-sm text-gold-200
                       transition active:scale-95 hover:bg-white/10"
          >
            خروج
          </button>
          </div>
        </div>
        <div className="brand-hairline" />
      </header>

      {/* key بالمسار يعيد تشغيل حركة الدخول عند كل تنقّل — إحساس بالانتقال
          بين الصفحات دون استخدام مكتبة توجيه متحركة كاملة. */}
      <main key={pathname} className="page-enter mx-auto max-w-3xl px-4 py-5">
        {children}
      </main>

      {/* شريط داكن فاخر (أخضر عميق بخيط ذهبي). مرفوع فوق شريط الآيفون السفلي: هامش أدنى
          ثابت حتى حين لا يعطينا المتصفح مقدار المنطقة الآمنة (env يساوي صفراً بدون viewport-fit). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-gold-500/30 bg-gradient-to-b from-brand-900/95 to-brand-950/95 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-lg"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 22px)" }}
      >
        <div className="brand-hairline" />
        {/* ثلاث صفحات: الرئيسية (كل التذاكر والبحث)، التقويم، واستلام قطعة. */}
        <div className="mx-auto grid max-w-3xl grid-cols-3 items-center gap-2 px-3 pb-1 pt-2.5">
          <Link
            to="/"
            className={`flex items-center justify-center gap-2 rounded-xl py-3 transition active:scale-95 ${
              onHome ? "bg-white/10 text-gold-200 ring-1 ring-gold-500/40" : "text-gold-100/55"
            }`}
          >
            <HomeIcon active={onHome} />
            <span className={`text-sm ${onHome ? "font-bold" : "font-medium"}`}>الرئيسية</span>
          </Link>

          <Link
            to="/calendar"
            className={`flex items-center justify-center gap-2 rounded-xl py-3 transition active:scale-95 ${
              onCalendar ? "bg-white/10 text-gold-200 ring-1 ring-gold-500/40" : "text-gold-100/55"
            }`}
          >
            <CalendarIcon active={onCalendar} />
            <span className={`text-sm ${onCalendar ? "font-bold" : "font-medium"}`}>التقويم</span>
          </Link>

          {/* زر الاستلام بالذهبي — أكثر إجراء يتكرّر في اليوم. */}
          <Link
            to="/tickets/new"
            className={`flex items-center justify-center gap-1.5 rounded-xl py-3 font-bold shadow-[0_6px_18px_-6px_rgba(201,162,74,0.7)] transition active:scale-95 ${
              onNew
                ? "bg-gold-100 text-brand-900 ring-2 ring-gold-400"
                : "bg-gradient-to-l from-gold-600 via-gold-400 to-gold-600 text-brand-950"
            }`}
          >
            <PlusIcon />
            <span className="text-sm">استلام قطعة</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
