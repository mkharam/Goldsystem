import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "الرئيسية" },
  { to: "/tickets", label: "التذاكر" },
  { to: "/tickets/new", label: "استلام قطعة" },
];

export function AppShell({
  children,
  inventoryDown,
}: {
  children: React.ReactNode;
  inventoryDown?: boolean;
}) {
  const { staff, signOut } = useAuth();
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh pb-20">
      <header className="brand-surface sticky top-0 z-20 text-white shadow-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={34} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gold-100">{staff?.full_name}</p>
              {inventoryDown && (
                // الموظف يجب أن يعرف أن التعبئة التلقائية معطّلة قبل أن يبحث بالكود
                // ويظن أن القطعة غير موجودة.
                <p className="truncate text-xs text-gold-300/80">المخزون غير متصل — الإدخال يدوي</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="shrink-0 rounded-lg border border-gold-500/30 px-3 py-1.5 text-sm text-gold-200 hover:bg-white/10"
          >
            خروج
          </button>
        </div>
        <div className="brand-hairline" />
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-3">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`px-2 py-3 text-center text-sm font-medium transition ${
                pathname === item.to ? "text-brand-700" : "text-slate-600 hover:text-brand-700"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
