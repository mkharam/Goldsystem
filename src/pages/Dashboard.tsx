import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { BranchPicker, useBranches } from "@/components/BranchPicker";
import { useAuth } from "@/lib/auth";
import { getSettings, getStatusCounts, listTickets, type StatusCounts } from "@/lib/tickets";
import { REPAIR_STATUS } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import { notifyCustomer } from "@/lib/whatsapp";
import { inventoryHealth, syncTickets } from "@/lib/inventory";
import { useToast } from "@/lib/toast";
import type { RepairStatus, TicketWithRelations } from "@/lib/types";

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

type TabKey = RepairStatus | "all" | "overdue";

// ترتيب التبويبات بترتيب العمل اليومي: الكل، ثم ما يحتاج انتباهاً، ثم مراحل القطعة.
const TABS: { key: TabKey; label: string; tone: string }[] = [
  { key: "all", label: "الكل", tone: "text-slate-800" },
  { key: "overdue", label: "متأخّرة", tone: "text-red-700" },
  { key: "ready", label: "جاهزة", tone: "text-brand-700" },
  { key: "received", label: REPAIR_STATUS.received.label, tone: "text-gold-800" },
  { key: "in_progress", label: REPAIR_STATUS.in_progress.label, tone: "text-blue-700" },
  { key: "delivered", label: REPAIR_STATUS.delivered.label, tone: "text-slate-600" },
  { key: "cancelled", label: REPAIR_STATUS.cancelled.label, tone: "text-red-600" },
];

const PAGE = 40;

const DAY_LABEL = new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });

/** عنوان مجموعة اليوم: «اليوم»، «أمس»، أو اسم اليوم والتاريخ. */
function dayTitle(iso: string): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(d)) / DAY_MS);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "أمس";
  return DAY_LABEL.format(d);
}

export default function Dashboard() {
  const { staff } = useAuth();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const branches = useBranches();
  // نبدأ من فرع الموظف: ما يخصّه أولاً، وله أن يوسّع للكل.
  const [branch, setBranch] = useState<string | "all">(staff?.branch_id ?? "all");
  // التبويب والبحث في الرابط: الرجوع من تفاصيل تذكرة يعيد الموظف لنفس القائمة.
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey | null) ?? "all";
  const search = params.get("q") ?? "";
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && !(key === "tab" && value === "all")) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [tickets, setTickets] = useState<TicketWithRelations[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [listLoading, setListLoading] = useState(true);
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

  const branchId = branch === "all" ? undefined : branch;

  // الأرقام والإعدادات — مرة لكل فرع.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [c, settings] = await Promise.all([getStatusCounts(branchId), getSettings()]);
        if (!active) return;
        setCounts(c);
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
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "تعذّر تحميل البيانات");
      }
      const health = await inventoryHealth();
      if (active) setInventoryDown(health === "down");
    })();
    return () => {
      active = false;
    };
  }, [branch]);

  // تغيير التبويب أو البحث أو الفرع يبدأ القائمة من أولها.
  useEffect(() => setLimit(PAGE), [tab, search, branch]);

  // القائمة نفسها — كل التذاكر من الأحدث، بمهلة قصيرة أثناء الكتابة في البحث.
  useEffect(() => {
    let active = true;
    setListLoading(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await listTickets({ status: tab, search, branchId, newest: true, limit });
        if (!active) return;
        setTickets(rows);
        const readyIds = rows.filter((t) => t.status === "ready").map((t) => t.id);
        if (readyIds.length) {
          const { data: notes } = await supabase
            .from("repair_notifications")
            .select("ticket_id, created_at")
            .in("ticket_id", readyIds)
            .order("created_at", { ascending: false });
          const latest: Record<string, string> = {};
          for (const n of notes ?? []) if (!latest[n.ticket_id]) latest[n.ticket_id] = n.created_at;
          if (active) setLastNotified(latest);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "تعذّر تحميل التذاكر");
      }
      if (active) setListLoading(false);
    }, search ? 250 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tab, search, branch, limit]);

  // تجميع حسب يوم الاستلام — قائمة طويلة تُقرأ أسهل مقسّمة: اليوم، أمس، …
  const groups = useMemo(() => {
    const out: { title: string; items: TicketWithRelations[] }[] = [];
    for (const t of tickets) {
      const title = dayTitle(t.received_at);
      const last = out[out.length - 1];
      if (last && last.title === title) last.items.push(t);
      else out.push({ title, items: [t] });
    }
    return out;
  }, [tickets]);

  const total = counts?.[tab] ?? null;
  const hasMore = !search && total !== null && tickets.length < total;

  return (
    <AppShell inventoryDown={inventoryDown}>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      <Link to="/tickets/new" className="btn-primary mb-3 w-full py-4 text-base shadow-sm">
        + استلام قطعة جديدة
      </Link>

      {/* بحث فوري: زبون يسأل عن قطعته — اسمه أو هاتفه أو رقم التذكرة أو التاريخ. */}
      <div className="relative mb-3">
        <input
          className="field pr-10"
          placeholder="ابحث بأي شيء: الاسم، الهاتف، القطعة، الموظف، التاريخ 28/9…"
          value={search}
          onChange={(e) => setParam("q", e.target.value)}
          enterKeyHint="search"
        />
        <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth={2}>
          <circle cx="11" cy="11" r="7" stroke="currentColor" />
          <path d="m20 20-3.2-3.2" stroke="currentColor" strokeLinecap="round" />
        </svg>
        {search && (
          <button type="button" onClick={() => setParam("q", "")} aria-label="مسح البحث"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth={2.4}>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* المبدّل للمدير العام فقط — غيره يرى فرعه وحده، وقاعدة البيانات تفرض ذلك أيضاً. */}
      {staff?.role === "admin" && <BranchPicker branches={branches} value={branch} onChange={setBranch} />}

      {/* تبويبات الحالات بأرقامها — لمسة واحدة تنقل بين الأقسام، والرقم يقول أين العمل.
          تلتصق أعلى الشاشة أثناء التمرير فلا يحتاج الموظف للرجوع لأعلى القائمة. */}
      <div className="sticky top-[57px] z-10 -mx-4 mb-3 overflow-x-auto bg-slate-50/95 px-4 py-2 backdrop-blur">
        <div className="flex w-max gap-2">
          {TABS.map((t) => {
            const active = t.key === tab;
            const n = counts?.[t.key];
            if (t.key === "overdue" && !n && !active) return null;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setParam("tab", t.key)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition active:scale-95 ${
                  active
                    ? "border-brand-700 bg-brand-700 font-semibold text-gold-100"
                    : "border-slate-300 bg-white text-slate-600 hover:border-brand-300"
                }`}
              >
                {t.label}
                {n !== undefined && (
                  <span className={`min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums ${
                    active ? "bg-white/15 text-gold-100" : `bg-slate-100 ${t.tone}`
                  }`}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {listLoading && tickets.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="card h-[92px] animate-pulse bg-slate-100" />)}
        </div>
      ) : tickets.length === 0 ? (
        <div className="card card-enter p-8 text-center">
          <p className="mb-1 text-3xl">{search ? "🔍" : "✨"}</p>
          <p className="text-sm text-slate-500">{search ? "لا نتائج مطابقة لبحثك" : "لا توجد تذاكر هنا"}</p>
        </div>
      ) : (
        <div className={`space-y-5 transition-opacity ${listLoading ? "opacity-60" : ""}`}>
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                {g.title}
                <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs font-medium text-slate-500">
                  {g.items.length}
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </h2>
              <div className="space-y-2">
                {g.items.map((t, i) => (
                  <div key={t.id}>
                    <TicketCard ticket={t} index={i} />
                    {t.status === "ready" && (
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
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}

          {hasMore && (
            <button
              type="button"
              disabled={listLoading}
              onClick={() => setLimit((l) => l + PAGE)}
              className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {listLoading ? "جارٍ التحميل…" : `عرض المزيد (${(total ?? 0) - tickets.length} متبقية)`}
            </button>
          )}
        </div>
      )}

      {lowRatings.length > 0 && (
        <section className="mt-8">
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
