import Link from "next/link";
import { requireStaff } from "@/lib/guard";
import { AppShell } from "@/components/AppShell";
import { TicketCard } from "@/components/TicketCard";
import { listTickets } from "@/lib/tickets";
import { REPAIR_STATUS } from "@/lib/constants";
import type { RepairStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "المفتوحة" },
  { key: "overdue", label: "المتأخّرة" },
  ...(Object.keys(REPAIR_STATUS) as RepairStatus[]).map((s) => ({
    key: s,
    label: REPAIR_STATUS[s].label,
  })),
];

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status = params.status ?? "open";
  const search = params.q ?? "";

  const tickets = await listTickets({
    status: status as RepairStatus | "open" | "overdue",
    search,
  });

  return (
    <AppShell staff={staff}>
      <form className="mb-3">
        {status && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={search}
          className="field"
          placeholder="ابحث برقم التذكرة أو كود القطعة أو اسمها"
          // البحث يُرسل بالإدخال؛ لا زر لأن الموظف يبحث بالماسح غالباً.
        />
      </form>

      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex w-max gap-2">
          {FILTERS.map((filter) => {
            const active = filter.key === status;
            const href = `/tickets?status=${filter.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`;
            return (
              <Link
                key={filter.key}
                href={href}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
                  active
                    ? "border-gold-500 bg-gold-500 font-semibold text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:border-gold-300"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      </div>

      {tickets.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">لا توجد تذاكر مطابقة</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
