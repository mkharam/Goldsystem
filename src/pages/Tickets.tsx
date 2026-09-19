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
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [tickets, setTickets] = useState<TicketWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listTickets({
      status: status as RepairStatus | "open" | "overdue",
      search: params.get("q") ?? "",
      branchId: branch === "all" ? undefined : branch,
    })
      .then((rows) => active && setTickets(rows))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [status, params, branch]);

  return (
    <AppShell>
      <form
        className="mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          if (search.trim()) next.set("q", search.trim());
          else next.delete("q");
          setParams(next);
        }}
      >
        <input
          className="field"
          placeholder="ابحث برقم التذكرة أو اسم القطعة"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <BranchPicker branches={branches} value={branch} onChange={setBranch} />

      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex w-max gap-2">
          {FILTERS.map((filter) => {
            const active = filter.key === status;
            const q = params.get("q");
            return (
              <Link
                key={filter.key}
                to={`/tickets?status=${filter.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
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
        <p className="card p-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>
      ) : tickets.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">لا توجد تذاكر مطابقة</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((t, i) => <TicketCard key={t.id} ticket={t} index={i} />)}
        </div>
      )}
    </AppShell>
  );
}
