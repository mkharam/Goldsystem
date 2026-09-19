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

function TicketsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.4 : 2}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5a1.5 1.5 0 0 0 0-3V8Z"
        stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 6.5v11" stroke="currentColor" strokeLinecap="round" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" strokeWidth={2.6}>
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
  const onTickets = pathname.startsWith("/tickets") && pathname !== "/tickets/new";
  const onNew = pathname === "/tickets/new";

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
        <div className="mx-auto grid max-w-3xl grid-cols-3 items-end px-2">
          <Link
            to="/"
            className={`flex flex-col items-center gap-1 py-2.5 transition active:scale-95 ${
              onHome ? "text-brand-700" : "text-slate-400"
            }`}
          >
            <HomeIcon active={onHome} />
            <span className={`text-[11px] ${onHome ? "font-bold" : "font-medium"}`}>الرئيسية</span>
          </Link>

          {/* زر الاستلام مرفوع فوق الشريط ومميّز بالذهبي — أكثر إجراء يتكرّر
              في اليوم، فلا يُعامل كتبويب عادي بين اثنين آخرين. */}
          <Link to="/tickets/new" className="flex flex-col items-center">
            <span
              className={`-mt-6 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg
                          ring-4 ring-white transition active:scale-90 ${
                            onNew ? "bg-brand-700" : "bg-gold-600"
                          }`}
            >
              <PlusIcon />
            </span>
            <span className={`mt-1 text-[11px] ${onNew ? "font-bold text-brand-700" : "font-medium text-slate-500"}`}>
              استلام قطعة
            </span>
          </Link>

          <Link
            to="/tickets"
            className={`flex flex-col items-center gap-1 py-2.5 transition active:scale-95 ${
              onTickets ? "text-brand-700" : "text-slate-400"
            }`}
          >
            <TicketsIcon active={onTickets} />
            <span className={`text-[11px] ${onTickets ? "font-bold" : "font-medium"}`}>التذاكر</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
