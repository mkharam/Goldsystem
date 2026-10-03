import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { ReadyAction, needsNotification } from "@/components/ReadyAction";
import { BranchPicker, useBranches } from "@/components/BranchPicker";
import { useAuth } from "@/lib/auth";
import { getSettings, listTickets } from "@/lib/tickets";
import { supabase } from "@/lib/supabase";
import { notifyCustomer } from "@/lib/whatsapp";
import { useToast } from "@/lib/toast";
import type { TicketWithRelations } from "@/lib/types";

type TabKey = "needs" | "notified" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "needs", label: "تحتاج تبليغ" },
  { key: "notified", label: "جاهزة" },
  { key: "all", label: "الكل" },
];

/**
 * صفحة مخصّصة للقطع الجاهزة: ما يحتاج تبليغاً الآن منفصل عمّا أُبلغ به الزبون
 * وهو بانتظار الاستلام، مع تبويب ثالث يجمعهما — دون أن يبحث الموظف بينها في
 * قائمة التذاكر الطويلة.
 */
export default function Notify() {
  const { staff } = useAuth();
  const toast = useToast();
  const branches = useBranches();
  const [branch, setBranch] = useState<string | "all">(staff?.branch_id ?? "all");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey | null) ?? "needs";
  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    if (key === "needs") next.delete("tab");
    else next.set("tab", key);
    setParams(next, { replace: true });
  };

  const [tickets, setTickets] = useState<TicketWithRelations[]>([]);
  const [lastNotified, setLastNotified] = useState<Record<string, string>>({});
  const [reminderDays, setReminderDays] = useState(3);
  const [shopName, setShopName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const branchId = branch === "all" ? undefined : branch;

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const [rows, settings] = await Promise.all([
          listTickets({ status: "ready", branchId, newest: true, limit: 200 }),
          getSettings(),
        ]);
        if (!active) return;
        setTickets(rows);
        setReminderDays(Number(settings.pickup_reminder_days) || 3);
        setShopName(settings.shop_name);

        const ids = rows.map((t) => t.id);
        if (ids.length) {
          const { data: notes } = await supabase
            .from("repair_notifications")
            .select("ticket_id, created_at")
            .in("ticket_id", ids)
            .order("created_at", { ascending: false });
          const latest: Record<string, string> = {};
          for (const n of notes ?? []) if (!latest[n.ticket_id]) latest[n.ticket_id] = n.created_at;
          if (active) setLastNotified(latest);
        } else {
          setLastNotified({});
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "تعذّر تحميل التذاكر");
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [branch]);

  const { needs, notified } = useMemo(() => {
    const needs: TicketWithRelations[] = [];
    const notified: TicketWithRelations[] = [];
    for (const t of tickets) {
      if (needsNotification(t, lastNotified[t.id] ?? null, reminderDays)) needs.push(t);
      else notified.push(t);
    }
    return { needs, notified };
  }, [tickets, lastNotified, reminderDays]);

  const shown = tab === "needs" ? needs : tab === "notified" ? notified : tickets;

  return (
    <AppShell>
      <h1 className="mb-3 text-lg font-bold text-slate-900">إبلاغ الزبون</h1>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      {staff?.role === "admin" && <BranchPicker branches={branches} value={branch} onChange={setBranch} />}

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => {
          const active = t.key === tab;
          const n = t.key === "needs" ? needs.length : t.key === "notified" ? notified.length : tickets.length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm transition active:scale-95 ${
                active
                  ? "border-brand-700 bg-brand-700 font-semibold text-gold-100"
                  : "border-slate-300 bg-white text-slate-600 hover:border-brand-300"
              }`}
            >
              {t.label}
              <span className={`min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums ${
                active ? "bg-white/15 text-gold-100" : "bg-slate-100 text-slate-600"
              }`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="card h-[92px] animate-pulse bg-slate-100" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="card card-enter p-8 text-center">
          <p className="mb-1 text-3xl">✨</p>
          <p className="text-sm text-slate-500">
            {tab === "needs" ? "لا توجد قطعة تحتاج تبليغاً الآن" : "لا توجد قطع هنا"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((t, i) => (
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
      )}
    </AppShell>
  );
}
