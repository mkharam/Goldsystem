import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { BranchPicker, useBranches } from "@/components/BranchPicker";
import { useAuth } from "@/lib/auth";
import { getDashboardStats, getSettings, listTickets, type DashboardStats } from "@/lib/tickets";
import { supabase } from "@/lib/supabase";
import { notifyCustomer } from "@/lib/whatsapp";
import { inventoryHealth, syncTickets } from "@/lib/inventory";
import { useToast } from "@/lib/toast";
import type { TicketWithRelations } from "@/lib/types";

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`card p-3 ${tone}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * إجراء واتساب للتذكرة الجاهزة: «أبلغ» إن لم يُبلَّغ الزبون بعد جاهزيتها، «ذكّر» إن مرّت
 * أيام التذكير على الجاهزية وعلى آخر إشعار دون تسليم، وإلا نُظهر فقط أنه أُبلغ.
 */
function ReadyAction({
  ticket, lastNotifiedAt, reminderDays, onSend,
}: {
  ticket: TicketWithRelations;
  lastNotifiedAt: string | null;
  reminderDays: number;
  onSend: (kind: "ready" | "reminder") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (!ticket.customer?.phone) return null;

  const readyAt = new Date(ticket.ready_at ?? ticket.received_at).getTime();
  const notifiedAt = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : null;
  const notifiedSinceReady = notifiedAt !== null && notifiedAt >= readyAt;
  const dueForReminder =
    notifiedSinceReady &&
    Date.now() - readyAt >= reminderDays * DAY_MS &&
    Date.now() - (notifiedAt as number) >= reminderDays * DAY_MS;

  if (notifiedSinceReady && !dueForReminder) {
    return <p className="mb-2 mt-1 text-center text-xs text-slate-400">✓ أُبلغ الزبون</p>;
  }
  const kind = notifiedSinceReady ? "reminder" : "ready";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => { setBusy(true); await onSend(kind); setBusy(false); }}
      className="btn-success mb-2 mt-1 w-full py-2 text-sm"
    >
      {kind === "ready" ? "أبلغ الزبون عبر واتساب" : "ذكّر الزبون بالاستلام"}
    </button>
  );
}

export default function Dashboard() {
  const { staff } = useAuth();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const branches = useBranches();
  // نبدأ من فرع الموظف: ما يخصّه أولاً، وله أن يوسّع للكل.
  const [branch, setBranch] = useState<string | "all">(staff?.branch_id ?? "all");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [overdue, setOverdue] = useState<TicketWithRelations[]>([]);
  const [ready, setReady] = useState<TicketWithRelations[]>([]);
  // آخر إشعار واتساب لكل تذكرة جاهزة، وأيام التذكير، واسم المحل للرسالة.
  const [lastNotified, setLastNotified] = useState<Record<string, string>>({});
  const [reminderDays, setReminderDays] = useState(3);
  const [shopName, setShopName] = useState("");
  const [lowRatings, setLowRatings] = useState<{
    ticket_id: string; rating: number; comment: string | null; created_at: string;
    ticket: { ticket_number: string; item_name: string; customer: { full_name: string } | null } | null;
  }[]>([]);
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
          listTickets({ status: "ready", limit: 20, branchId }),
        ]);
        if (!active) return;
        setStats(s);
        setOverdue(o);
        setReady(r);
        const [settings, notes] = await Promise.all([
          getSettings(),
          r.length
            ? supabase.from("repair_notifications").select("ticket_id, created_at").in("ticket_id", r.map((t) => t.id)).order("created_at", { ascending: false })
            : Promise.resolve({ data: [] as { ticket_id: string; created_at: string }[] }),
        ]);
        if (!active) return;
        setReminderDays(Number(settings.pickup_reminder_days) || 3);
        setShopName(settings.shop_name);
        // تقييمات منخفضة (نجمتان فأقل) — للمدير والمشرف لا الموظف؛ RLS تحصر المشرف بفرعه.
        if (staff && staff.role !== "employee") {
          const { data: low } = await supabase
            .from("repair_feedback")
            .select("ticket_id, rating, comment, created_at, ticket:repair_tickets(ticket_number, item_name, customer:customers(full_name))")
            .lte("rating", 2)
            .order("created_at", { ascending: false })
            .limit(10);
          if (active) setLowRatings((low ?? []) as unknown as typeof lowRatings);
        }
        const latest: Record<string, string> = {};
        for (const n of notes.data ?? []) if (!latest[n.ticket_id]) latest[n.ticket_id] = n.created_at;
        setLastNotified(latest);
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
            {ready.map((t, i) => (
              <div key={t.id}>
                <TicketCard ticket={t} index={i} />
                <ReadyAction
                  ticket={t}
                  lastNotifiedAt={lastNotified[t.id] ?? null}
                  reminderDays={reminderDays}
                  onSend={async (kind) => {
                    if (!staff) return;
                    const ok = await notifyCustomer(t, kind, shopName, staff.staff_id);
                    if (!ok) return toast("رقم الزبون غير صالح", "error");
                    setLastNotified((m) => ({ ...m, [t.id]: new Date().toISOString() }));
                  }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {lowRatings.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-bold text-slate-900">
            تقييمات منخفضة{" "}
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{lowRatings.length}</span>
          </h2>
          <div className="space-y-2">
            {lowRatings.map((f) => (
              <Link key={f.ticket_id} to={`/tickets/${f.ticket_id}`} className="card block p-3 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-800">
                    {f.ticket?.item_name ?? "—"} · {f.ticket?.customer?.full_name ?? ""}
                  </span>
                  <span className="shrink-0 text-gold-600" aria-label={`${f.rating} من 5`}>
                    {"★".repeat(f.rating)}<span className="text-slate-300">{"★".repeat(5 - f.rating)}</span>
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{f.ticket?.ticket_number}</p>
                {f.comment && <p className="mt-1 text-sm text-slate-600">{f.comment}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {staff?.role === "admin" && (
        <section className="mt-8 border-t border-slate-200 pt-4">
          <button
            type="button"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              const ok = await syncTickets({ all: true });
              setSyncing(false);
              toast(ok ? "تمت مزامنة كل التذاكر مع المخزون" : "تعذّرت المزامنة — حاول لاحقاً", ok ? "success" : "error");
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {syncing ? "جارٍ المزامنة…" : "مزامنة كل التذاكر مع المخزون"}
          </button>
          <p className="mt-1.5 text-center text-xs text-slate-400">
            تحدث المزامنة تلقائياً مع كل تعديل؛ استعمل هذا الزر إن لم تظهر تذكرة في صفحة الصيانة عند المخزون.
          </p>
        </section>
      )}
    </AppShell>
  );
}
