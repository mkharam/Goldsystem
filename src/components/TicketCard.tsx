import { Link } from "react-router-dom";
import { StatusBadge } from "./StatusBadge";
import { formatWeight, overdueLabel, daysFromNow, formatDateTime } from "@/lib/format";
import { OPEN_STATUSES } from "@/lib/constants";
import type { TicketWithRelations } from "@/lib/types";

export function TicketCard({ ticket, index = 0 }: { ticket: TicketWithRelations; index?: number }) {
  const isOpen = OPEN_STATUSES.includes(ticket.status);
  const days = daysFromNow(ticket.promised_at);
  const isOverdue = isOpen && days !== null && days < 0;
  const due = isOpen ? overdueLabel(ticket.promised_at) : null;

  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className={`card card-enter block p-3 transition hover:border-gold-300 hover:shadow active:scale-[0.98] ${
        isOverdue ? "border-red-200 bg-red-50/40" : ""
      }`}
      // تتالي خفيف عند ظهور القائمة، محدود بأول ثماني بطاقات حتى لا تصبح
      // القائمة الطويلة بطيئة الظهور.
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <div className="flex gap-3">
      {ticket.photo_url && (
        <img
          src={ticket.photo_url}
          alt=""
          loading="lazy"
          className="h-[72px] w-[72px] shrink-0 rounded-lg border border-gold-200 bg-white object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-900">{ticket.item_name}</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {ticket.customer?.full_name ?? "—"}
            {ticket.customer?.phone && <span className="text-slate-400"> · {ticket.customer.phone}</span>}
          </p>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="font-mono text-slate-600">{ticket.ticket_number}</span>
        {ticket.karat && <span>{ticket.karat}</span>}
        {ticket.weight_in_grams !== null && <span>{formatWeight(ticket.weight_in_grams)}</span>}
        {ticket.branch?.name && <span>{ticket.branch.name}</span>}
        {due && <span className={isOverdue ? "font-semibold text-red-600" : "text-slate-500"}>{due}</span>}
      </div>

      {/* من استلم القطعة ومتى — الزبون يسأل كثيراً "مع من تركتها؟". */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
        <span>
          <span className="text-slate-400">الموظف: </span>
          <span className="font-medium text-slate-700">{ticket.received_by_staff?.full_name ?? "—"}</span>
        </span>
        <span className="text-slate-400">{formatDateTime(ticket.received_at)}</span>
      </div>
      </div>
      </div>
    </Link>
  );
}
