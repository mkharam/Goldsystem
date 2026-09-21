import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { BranchPicker, useBranches } from "@/components/BranchPicker";
import { useAuth } from "@/lib/auth";
import { getDashboardStats, listTickets, type DashboardStats } from "@/lib/tickets";
import { inventoryHealth } from "@/lib/inventory";
import type { TicketWithRelations } from "@/lib/types";

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`card p-3 ${tone}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}

export default function Dashboard() {
  const { staff } = useAuth();
  const branches = useBranches();
  // نبدأ من فرع الموظف: ما يخصّه أولاً، وله أن يوسّع للكل.
  const [branch, setBranch] = useState<string | "all">(staff?.branch_id ?? "all");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [overdue, setOverdue] = useState<TicketWithRelations[]>([]);
  const [ready, setReady] = useState<TicketWithRelations[]>([]);
  const [inventoryDown, setInventoryDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const branchId = branch === "all" ? undefined : branch;
    (async () => {
      try {
        const [s, o, r] = await Promise.all([
          getDashboardStats(branchId),
          listTickets({ status: "overdue", limit: 10, branchId }),
          listTickets({ status: "ready", limit: 5, branchId }),
        ]);
        if (!active) return;
        setStats(s);
        setOverdue(o);
        setReady(r);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "تعذّر تحميل البيانات");
      }
      if (active) setLoading(false);
      const health = await inventoryHealth();
      if (active) setInventoryDown(health === "down");
    })();
    return () => {
      active = false;
    };
  }, [branch]);

  return (
    <AppShell inventoryDown={inventoryDown}>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      <Link to="/tickets/new" className="btn-primary mb-4 w-full py-4 text-base shadow-sm">
        + استلام قطعة جديدة
      </Link>

      {/* المبدّل للمدير العام فقط — غيره يرى فرعه وحده، وقاعدة البيانات تفرض ذلك أيضاً. */}
      {staff?.role === "admin" && <BranchPicker branches={branches} value={branch} onChange={setBranch} />}

      {loading ? (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="card h-[60px] animate-pulse bg-slate-100" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="متأخّرة" value={stats?.overdue ?? 0} tone="text-red-700" />
          <StatCard label="جاهزة" value={stats?.ready ?? 0} tone="text-brand-700" />
          <StatCard label="قيد العمل" value={stats?.inProgress ?? 0} tone="text-slate-800" />
        </div>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">
            متأخّرة{" "}
            {(stats?.overdue ?? 0) > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{stats?.overdue}</span>
            )}
          </h2>
          {(stats?.overdue ?? 0) > 0 && (
            <Link to="/tickets?status=overdue" className="text-sm text-gold-700 hover:underline">الكل</Link>
          )}
        </div>

        {loading ? (
          <div className="card h-[72px] animate-pulse bg-slate-100" />
        ) : overdue.length === 0 ? (
          <div className="card card-enter p-6 text-center">
            <p className="mb-1 text-2xl">✨</p>
            <p className="text-sm text-slate-500">لا توجد تذاكر متأخّرة — كل شيء على وقته</p>
          </div>
        ) : (
          <div className="space-y-2">
            {overdue.map((t, i) => <TicketCard key={t.id} ticket={t} index={i} />)}
          </div>
        )}
      </section>

      {!loading && ready.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">جاهزة للتسليم</h2>
            <Link to="/tickets?status=ready" className="text-sm text-gold-700 hover:underline">الكل</Link>
          </div>
          <div className="space-y-2">
            {ready.map((t, i) => <TicketCard key={t.id} ticket={t} index={i} />)}
          </div>
        </section>
      )}
    </AppShell>
  );
}
