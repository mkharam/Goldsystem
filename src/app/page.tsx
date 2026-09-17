import Link from "next/link";
import { requireStaff } from "@/lib/guard";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { getDashboardStats, listTickets } from "@/lib/tickets";
import { inventoryHealth } from "@/lib/inventory";

export const dynamic = "force-dynamic";

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`card p-3 ${tone}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const staff = await requireStaff();

  const [stats, overdue, ready, health] = await Promise.all([
    getDashboardStats(),
    listTickets({ status: "overdue", limit: 10 }),
    listTickets({ status: "ready", limit: 5 }),
    inventoryHealth(),
  ]);

  return (
    <AppShell staff={staff} inventoryStatus={health}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="مفتوحة" value={stats.open} tone="text-slate-800" />
        <StatCard label="متأخّرة" value={stats.overdue} tone="text-red-700" />
        <StatCard label="جاهزة للتسليم" value={stats.ready} tone="text-brand-700" />
        <StatCard label="سُلّمت اليوم" value={stats.deliveredToday} tone="text-slate-800" />
      </div>

      <Link href="/tickets/new" className="btn-primary mt-4 w-full py-3 text-base">
        استلام قطعة جديدة
      </Link>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">
            متأخّرة{" "}
            {stats.overdue > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                {stats.overdue}
              </span>
            )}
          </h2>
          {stats.overdue > 0 && (
            <Link href="/tickets?status=overdue" className="text-sm text-gold-700 hover:underline">
              الكل
            </Link>
          )}
        </div>

        {overdue.length === 0 ? (
          <p className="card p-4 text-center text-sm text-slate-500">لا توجد تذاكر متأخّرة</p>
        ) : (
          <div className="space-y-2">
            {overdue.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}
      </section>

      {ready.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">جاهزة للتسليم</h2>
            <Link href="/tickets?status=ready" className="text-sm text-gold-700 hover:underline">
              الكل
            </Link>
          </div>
          <div className="space-y-2">
            {ready.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
