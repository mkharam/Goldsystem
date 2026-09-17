import { Link } from "react-router-dom";
import { StatusBadge } from "./StatusBadge";
import { formatWeight, overdueLabel, daysFromNow } from "@/lib/format";
import { OPEN_STATUSES } from "@/lib/constants";
import type { TicketWithRelations } from "@/lib/types";

export function TicketCard({ ticket }: { ticket: TicketWithRelations }) {
  const isOpen = OPEN_STATUSES.includes(ticket.status);
  const days = daysFromNow(ticket.promised_at);
  const isOverdue = isOpen && days !== null && days < 0;
  const due = isOpen ? overdueLabel(ticket.promised_at) : null;

  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className={`card block p-3 transition hover:border-gold-300 hover:shadow ${
        isOverdue ? "border-red-200 bg-red-50/40" : ""
      }`}
    >
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
    </Link>
  );
}
