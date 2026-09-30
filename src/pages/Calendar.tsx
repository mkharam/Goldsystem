import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { supabase } from "@/lib/supabase";
import { listTickets } from "@/lib/tickets";
import { OPEN_STATUSES } from "@/lib/constants";
import type { TicketWithRelations } from "@/lib/types";

/**
 * التقويم: شهر كامل بلمحة — كل يوم يُظهر ما حدث فيه (استُلم، جهز، سُلّم، ومواعيد)،
 * والضغط على يوم يعرض تذاكره فوراً. الأرقام تُجلب مرة للشهر، وتذاكر اليوم عند الضغط
 * وتُحفظ فلا يُعاد جلبها عند الرجوع لنفس اليوم.
 */

type Kind = "received" | "ready" | "delivered" | "due";

const KINDS: { key: Kind; label: string; field: "received_at" | "ready_at" | "delivered_at" | "promised_at"; dot: string; chip: string }[] = [
  { key: "received", label: "استُلمت", field: "received_at", dot: "bg-gold-500", chip: "bg-gold-100 text-gold-800" },
  { key: "ready", label: "جهزت", field: "ready_at", dot: "bg-brand-500", chip: "bg-brand-100 text-brand-800" },
  { key: "delivered", label: "سُلّمت", field: "delivered_at", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700" },
  { key: "due", label: "موعدها", field: "promised_at", dot: "bg-red-400", chip: "bg-red-50 text-red-700" },
];

// الأسبوع يبدأ السبت (ليبيا)، والشبكة من اليمين لليسار.
const WEEK = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const MONTH_FMT = new Intl.DateTimeFormat("ar-u-nu-latn", { month: "long", year: "numeric" });
const DAY_FMT = new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

type Counts = Record<string, Partial<Record<Kind, number>>>;

export default function Calendar() {
  // الشهر واليوم في الرابط: الرجوع من تذكرة يعيد الموظف لنفس اليوم.
  const [params, setParams] = useSearchParams();
  const today = keyOf(new Date());
  const selected = params.get("day") ?? today;
  const monthStart = useMemo(() => {
    const m = params.get("month");
    const base = m ? fromKey(`${m}-01`) : fromKey(selected);
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [params, selected]);

  const setView = (month: Date, day?: string) => {
    const next = new URLSearchParams(params);
    next.set("month", `${month.getFullYear()}-${pad(month.getMonth() + 1)}`);
    if (day) next.set("day", day);
    setParams(next, { replace: true });
  };

  const [counts, setCounts] = useState<Counts>({});
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [dayCache, setDayCache] = useState<Record<string, Record<Kind, TicketWithRelations[]>>>({});
  const [loadingDay, setLoadingDay] = useState(false);

  // أرقام الشهر: حقول التاريخ فقط، أربعة طلبات صغيرة بالتوازي.
  useEffect(() => {
    let active = true;
    setLoadingMonth(true);
    const from = monthStart.toISOString();
    const to = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).toISOString();
    (async () => {
      const results = await Promise.all(KINDS.map((k) => {
        let q = supabase.from("repair_tickets").select(`id, status, ${k.field}`).gte(k.field, from).lt(k.field, to).limit(2000);
        if (k.key === "due") q = q.in("status", OPEN_STATUSES);
        return q;
      }));
      if (!active) return;
      const next: Counts = {};
      results.forEach(({ data }, i) => {
        const k = KINDS[i];
        for (const row of (data ?? []) as Record<string, string | null>[]) {
          const at = row[k.field];
          if (!at) continue;
          const day = keyOf(new Date(at));
          next[day] = { ...next[day], [k.key]: (next[day]?.[k.key] ?? 0) + 1 };
        }
      });
      setCounts(next);
      setLoadingMonth(false);
    })();
    return () => { active = false; };
  }, [monthStart]);

  // تذاكر اليوم المختار — تُجلب مرة وتُحفظ.
  useEffect(() => {
    if (dayCache[selected]) return;
    let active = true;
    setLoadingDay(true);
    const d = fromKey(selected);
    const from = d.toISOString();
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
    (async () => {
      const lists = await Promise.all(KINDS.map((k) =>
        listTickets({ range: { field: k.field, from, to }, newest: true, limit: 200, ...(k.key === "due" ? { status: "open" as const } : {}) })
          .catch(() => [] as TicketWithRelations[]),
      ));
      if (!active) return;
      setDayCache((c) => ({
        ...c,
        [selected]: Object.fromEntries(KINDS.map((k, i) => [k.key, lists[i]])) as Record<Kind, TicketWithRelations[]>,
      }));
      setLoadingDay(false);
    })();
    return () => { active = false; };
  }, [selected, dayCache]);

  // خلايا الشهر: فراغات قبل أول يوم حتى يقع تحت اسم يومه (السبت أولاً).
  const cells = useMemo(() => {
    const lead = (monthStart.getDay() + 1) % 7;
    const days = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1)),
    ];
  }, [monthStart]);

  const dayData = dayCache[selected];
  const monthTotal = Object.values(counts).reduce((n, c) => n + (c.received ?? 0), 0);
  const shift = (n: number) => setView(new Date(monthStart.getFullYear(), monthStart.getMonth() + n, 1));

  return (
    <AppShell>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label="الشهر السابق"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-lg text-slate-600 active:scale-90">
          ›
        </button>
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-900">{MONTH_FMT.format(monthStart)}</h1>
          <p className="text-xs text-slate-500">{loadingMonth ? "…" : `${monthTotal} قطعة استُلمت هذا الشهر`}</p>
        </div>
        <button type="button" onClick={() => shift(1)} aria-label="الشهر التالي"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-lg text-slate-600 active:scale-90">
          ‹
        </button>
      </div>

      <div className="card overflow-hidden p-2">
        <div className="grid grid-cols-7 pb-1 text-center text-[10px] font-semibold text-slate-400">
          {WEEK.map((w) => <span key={w}>{w.replace("ال", "")}</span>)}
        </div>
        <div className={`grid grid-cols-7 gap-1 transition-opacity ${loadingMonth ? "opacity-50" : ""}`}>
          {cells.map((d, i) => {
            if (!d) return <span key={`x${i}`} />;
            const k = keyOf(d);
            const c = counts[k] ?? {};
            const isSel = k === selected;
            const isToday = k === today;
            const busy = (c.received ?? 0) + (c.ready ?? 0) + (c.delivered ?? 0);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setView(monthStart, k)}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition active:scale-90 ${
                  isSel
                    ? "bg-brand-700 font-bold text-gold-100 shadow-md"
                    : isToday
                      ? "bg-gold-50 font-bold text-brand-800 ring-2 ring-gold-400"
                      : busy ? "bg-slate-50 font-semibold text-slate-800" : "text-slate-500"
                }`}
              >
                {d.getDate()}
                {/* نقاط ملوّنة: ما حدث في اليوم بلمحة */}
                <span className="mt-0.5 flex h-1.5 gap-0.5">
                  {KINDS.map((kind) => (c[kind.key] ? <span key={kind.key} className={`h-1.5 w-1.5 rounded-full ${kind.dot}`} /> : null))}
                </span>
                {(c.received ?? 0) > 0 && (
                  <span className={`absolute left-1 top-0.5 text-[9px] font-bold tabular-nums ${isSel ? "text-gold-200" : "text-gold-700"}`}>
                    {c.received}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
          {KINDS.map((k) => (
            <span key={k.key} className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />{k.label}</span>
          ))}
        </div>
      </div>

      {/* اليوم المختار */}
      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">
            {selected === today ? "اليوم" : DAY_FMT.format(fromKey(selected))}
          </h2>
          {selected !== today && (
            <button type="button" onClick={() => setView(new Date(), today)} className="text-sm text-gold-700 hover:underline">
              اليوم
            </button>
          )}
        </div>

        {loadingDay && !dayData ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="card h-[92px] animate-pulse bg-slate-100" />)}
          </div>
        ) : dayData && KINDS.every((k) => dayData[k.key].length === 0) ? (
          <div className="card p-8 text-center">
            <p className="mb-1 text-3xl">🗓️</p>
            <p className="text-sm text-slate-500">لا شيء في هذا اليوم</p>
          </div>
        ) : dayData ? (
          <div className="space-y-5">
            {KINDS.map((k) => dayData[k.key].length > 0 && (
              <section key={k.key}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${k.chip}`}>{k.label}</span>
                  <span className="text-xs font-medium text-slate-400">{dayData[k.key].length}</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </h3>
                <div className="space-y-2">
                  {dayData[k.key].map((t, i) => <TicketCard key={`${k.key}-${t.id}`} ticket={t} index={i} />)}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

