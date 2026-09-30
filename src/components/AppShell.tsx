import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";

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

  return (
    <div className="min-h-dvh pb-24">
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
          <button
            type="button"
            onClick={signOut}
            className="shrink-0 rounded-lg border border-gold-500/30 px-3 py-1.5 text-sm text-gold-200
                       transition active:scale-95 hover:bg-white/10"
          >
            خروج
          </button>
        </div>
        <div className="brand-hairline" />
      </header>

      {/* key بالمسار يعيد تشغيل حركة الدخول عند كل تنقّل — إحساس بالانتقال
          بين الصفحات دون استخدام مكتبة توجيه متحركة كاملة. */}
      <main key={pathname} className="page-enter mx-auto max-w-3xl px-4 py-5">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/90 backdrop-blur-lg"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ثلاث صفحات: الرئيسية (كل التذاكر والبحث)، التقويم، واستلام قطعة. */}
        <div className="mx-auto grid max-w-3xl grid-cols-3 items-center gap-2 px-3 py-2">
          <Link
            to="/"
            className={`flex items-center justify-center gap-2 rounded-xl py-3 transition active:scale-95 ${
              onHome ? "bg-brand-50 text-brand-700" : "text-slate-500"
            }`}
          >
            <HomeIcon active={onHome} />
            <span className={`text-sm ${onHome ? "font-bold" : "font-medium"}`}>الرئيسية</span>
          </Link>

          <Link
            to="/calendar"
            className={`flex items-center justify-center gap-2 rounded-xl py-3 transition active:scale-95 ${
              onCalendar ? "bg-brand-50 text-brand-700" : "text-slate-500"
            }`}
          >
            <CalendarIcon active={onCalendar} />
            <span className={`text-sm ${onCalendar ? "font-bold" : "font-medium"}`}>التقويم</span>
          </Link>

          {/* زر الاستلام بالذهبي — أكثر إجراء يتكرّر في اليوم. */}
          <Link
            to="/tickets/new"
            className={`flex items-center justify-center gap-1.5 rounded-xl py-3 text-white shadow-md transition active:scale-95 ${
              onNew ? "bg-brand-700" : "bg-gold-600"
            }`}
          >
            <PlusIcon />
            <span className="text-sm font-bold">استلام قطعة</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
