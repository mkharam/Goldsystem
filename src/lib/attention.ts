import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

/**
 * عدّادات «يحتاج انتباه» للشارة الحمراء على زر «إبلاغ»: القطع الجاهزة التي تحتاج تبليغ الزبون
 * (نفس قاعدة needsNotification: لم يُبلَّغ منذ جهزت، أو حان التذكير)، والقطع المستلمة التي لم
 * تُرسل للفني بعد. استعلامات خفيفة بلا صور، تُخزَّن دقيقة وتتجدد عند الرجوع للتطبيق.
 */
export type Attention = { notify: number; tech: number };

const DAY_MS = 86_400_000;
let cache: { key: string; at: number; value: Attention } | null = null;
const listeners = new Set<() => void>();

export function invalidateAttention() {
  cache = null;
  listeners.forEach((l) => l());
}

async function fetchAttention(branchId: string | null): Promise<Attention> {
  let ready = supabase.from("repair_tickets").select("id, ready_at, received_at, customer:customers!repair_tickets_customer_id_fkey (phone)").eq("status", "ready");
  let tech = supabase.from("repair_tickets").select("id", { count: "exact", head: true }).eq("status", "received").is("sent_to_tech_at", null);
  if (branchId) { ready = ready.eq("branch_id", branchId); tech = tech.eq("branch_id", branchId); }
  const [r, t, s] = await Promise.all([
    ready.limit(500),
    tech,
    supabase.from("settings").select("value").eq("key", "pickup_reminder_days").maybeSingle(),
  ]);
  const rows = (r.data ?? []) as unknown as { id: string; ready_at: string | null; received_at: string; customer: { phone: string | null } | null }[];
  const reminderDays = Number((s.data as { value?: unknown } | null)?.value) || 3;
  const latest: Record<string, number> = {};
  if (rows.length) {
    const { data: notes } = await supabase.from("repair_notifications").select("ticket_id, created_at").in("ticket_id", rows.map((x) => x.id));
    for (const n of notes ?? []) {
      const at = new Date(n.created_at).getTime();
      if (!latest[n.ticket_id] || at > latest[n.ticket_id]) latest[n.ticket_id] = at;
    }
  }
  const now = Date.now();
  const notify = rows.filter((x) => {
    if (!x.customer?.phone) return false;
    const readyAt = new Date(x.ready_at ?? x.received_at).getTime();
    const n = latest[x.id];
    if (!n || n < readyAt) return true;
    return now - readyAt >= reminderDays * DAY_MS && now - n >= reminderDays * DAY_MS;
  }).length;
  return { notify, tech: t.count ?? 0 };
}

export function useAttention(): Attention {
  const { staff } = useAuth();
  const branchId = staff?.role === "admin" ? null : staff?.branch_id ?? null;
  const key = `${staff?.staff_id ?? ""}:${branchId ?? "all"}`;
  const [value, setValue] = useState<Attention>(cache?.key === key ? cache.value : { notify: 0, tech: 0 });

  useEffect(() => {
    if (!staff) return;
    let alive = true;
    const run = async (force = false) => {
      if (!force && cache?.key === key && Date.now() - cache.at < 60_000) { setValue(cache.value); return; }
      try {
        const v = await fetchAttention(branchId);
        cache = { key, at: Date.now(), value: v };
        if (alive) setValue(v);
      } catch { /* الشارة ليست حرجة */ }
    };
    void run();
    const onRefresh = () => void run(true);
    const onVisible = () => { if (document.visibilityState === "visible") void run(); };
    listeners.add(onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void run(), 120_000);
    return () => { alive = false; listeners.delete(onRefresh); document.removeEventListener("visibilitychange", onVisible); window.clearInterval(timer); };
  }, [key, branchId, staff]);

  return value;
}
