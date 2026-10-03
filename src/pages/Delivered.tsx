import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { BranchPicker, useBranches } from "@/components/BranchPicker";
import { useAuth } from "@/lib/auth";
import { listTickets } from "@/lib/tickets";
import type { TicketWithRelations } from "@/lib/types";

const PAGE = 40;

/**
 * القطع المسلَّمة — خارج القائمة الرئيسية بعد انتهاء العمل عليها، لكن تبقى
 * قابلة للبحث والرجوع إليها هنا عند الحاجة (سؤال زبون، مراجعة).
 */
export default function Delivered() {
  const { staff } = useAuth();
  const branches = useBranches();
  const [branch, setBranch] = useState<string | "all">(staff?.branch_id ?? "all");
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const setSearch = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  };

  const [tickets, setTickets] = useState<TicketWithRelations[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const branchId = branch === "all" ? undefined : branch;

  useEffect(() => setLimit(PAGE), [search, branch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await listTickets({ status: "delivered", search, branchId, newest: true, limit });
        if (active) setTickets(rows);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "تعذّر تحميل التذاكر");
      }
      if (active) setLoading(false);
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [search, branch, limit]);

  return (
    <AppShell>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">القطع المسلَّمة</h1>
        <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">الرئيسية</Link>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

      <div className="relative mb-3">
        <input
          className="field pr-10"
          placeholder="ابحث: زبون، رقم تذكرة، قطعة…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          enterKeyHint="search"
        />
        <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth={2}>
          <circle cx="11" cy="11" r="7" stroke="currentColor" />
          <path d="m20 20-3.2-3.2" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </div>

      {staff?.role === "admin" && <BranchPicker branches={branches} value={branch} onChange={setBranch} />}

      {loading && tickets.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="card h-[92px] animate-pulse bg-slate-100" />)}
        </div>
      ) : tickets.length === 0 ? (
        <div className="card card-enter p-8 text-center">
          <p className="mb-1 text-3xl">{search ? "🔍" : "📦"}</p>
          <p className="text-sm text-slate-500">{search ? "لا نتائج مطابقة لبحثك" : "لا توجد قطع مسلَّمة بعد"}</p>
        </div>
      ) : (
        <div className={`space-y-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {tickets.map((t, i) => <TicketCard key={t.id} ticket={t} index={i} />)}

          {tickets.length >= limit && (
            <button
              type="button"
              disabled={loading}
              onClick={() => setLimit((l) => l + PAGE)}
              className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? "جارٍ التحميل…" : "عرض المزيد"}
            </button>
          )}
        </div>
      )}
    </AppShell>
  );
}
