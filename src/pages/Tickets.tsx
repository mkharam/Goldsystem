import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { BranchPicker, useBranches } from "@/components/BranchPicker";
import { useAuth } from "@/lib/auth";
import { listTickets } from "@/lib/tickets";
import { REPAIR_STATUS } from "@/lib/constants";
import type { RepairStatus, TicketWithRelations } from "@/lib/types";

const FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "المفتوحة" },
  { key: "overdue", label: "المتأخّرة" },
  ...(Object.keys(REPAIR_STATUS) as RepairStatus[]).map((s) => ({ key: s, label: REPAIR_STATUS[s].label })),
];

export default function Tickets() {
  const { staff } = useAuth();
  const branches = useBranches();
  const [branch, setBranch] = useState<string | "all">(staff?.branch_id ?? "all");
  const [params] = useSearchParams();
  const status = params.get("status") ?? "open";
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState<TicketWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  // بحث فوري أثناء الكتابة — بمهلة قصيرة حتى لا نستعلم على كل حرف، ولا حاجة
  // لزر إرسال يضيف خطوة لموظف يريد النتيجة فوراً.
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      listTickets({
        status: status as RepairStatus | "open" | "overdue",
        search,
        branchId: branch === "all" ? undefined : branch,
      })
        .then((rows) => active && setTickets(rows))
        .finally(() => active && setLoading(false));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status, search, branch]);

  return (
    <AppShell>
      <div className="relative mb-3">
        <input
          className="field pr-10"
          placeholder="ابحث برقم التذكرة أو اسم القطعة"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <svg
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth={2}
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" />
          <path d="m20 20-3.2-3.2" stroke="currentColor" strokeLinecap="round" />
        </svg>
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="مسح البحث"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth={2.4}>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* المبدّل للمدير العام فقط — غيره يرى فرعه وحده، وقاعدة البيانات تفرض ذلك أيضاً. */}
      {staff?.role === "admin" && <BranchPicker branches={branches} value={branch} onChange={setBranch} />}

      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex w-max gap-2">
          {FILTERS.map((filter) => {
            const active = filter.key === status;
            return (
              <Link
                key={filter.key}
                to={`/tickets?status=${filter.key}`}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition active:scale-95 ${
                  active
                    ? "border-brand-700 bg-brand-700 font-semibold text-gold-100"
                    : "border-slate-300 bg-white text-slate-600 hover:border-brand-300"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-[72px] animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="card card-enter p-8 text-center">
          <p className="mb-1 text-3xl">🔍</p>
          <p className="text-sm text-slate-500">
            {search ? "لا نتائج مطابقة لبحثك" : "لا توجد تذاكر هنا"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t, i) => <TicketCard key={t.id} ticket={t} index={i} />)}
        </div>
      )}
    </AppShell>
  );
}
