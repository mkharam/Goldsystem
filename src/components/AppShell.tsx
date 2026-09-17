import Link from "next/link";
import { logout } from "@/app/actions/auth";
import type { SessionStaff } from "@/lib/types";

const NAV = [
  { href: "/", label: "الرئيسية" },
  { href: "/tickets", label: "التذاكر" },
  { href: "/tickets/new", label: "استلام قطعة" },
];

export function AppShell({
  staff,
  children,
  inventoryStatus,
}: {
  staff: SessionStaff;
  children: React.ReactNode;
  inventoryStatus?: "ok" | "down" | "disabled";
}) {
  return (
    <div className="min-h-dvh pb-20">
      <header className="sticky top-0 z-20 border-b border-gold-200 bg-gradient-to-l from-gold-600 to-gold-500 text-white shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{staff.full_name}</p>
            {inventoryStatus === "down" && (
              // الموظف يجب أن يعرف أن التعبئة التلقائية معطّلة قبل أن يبحث بالكود
              // ويظن أن القطعة غير موجودة.
              <p className="text-xs text-gold-100">المخزون غير متصل — الإدخال يدوي</p>
            )}
          </div>
          <form action={logout}>
            <button type="submit" className="rounded-lg px-3 py-1.5 text-sm hover:bg-white/15">
              خروج
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-2 py-3 text-center text-sm font-medium text-slate-600 hover:text-gold-700"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
