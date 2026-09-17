import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTicket, getSettings, type Settings } from "@/lib/tickets";
import { formatDateTime, formatWeight, formatMoney } from "@/lib/format";
import { Logo } from "@/components/Logo";
import type { TicketWithRelations } from "@/lib/types";

export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketWithRelations | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [t, s] = await Promise.all([getTicket(id), getSettings()]);
      setTicket(t);
      setSettings(s);
    })();
  }, [id]);

  if (!ticket || !settings) {
    return <div className="p-8 text-center text-slate-400">جارٍ التحميل…</div>;
  }

  return (
    <div className="mx-auto max-w-sm p-4">
      <div className="no-print mb-4 flex gap-2">
        <Link to={`/tickets/${ticket.id}`} className="btn-ghost flex-1">التذكرة</Link>
        <button type="button" onClick={() => window.print()} className="btn-primary flex-1">طباعة</button>
      </div>

      <div className="card overflow-hidden print:border-0 print:shadow-none">
        {/* ترويسة الهوية — تُطبع بالأسود على الطابعات الحرارية وتبقى مقروءة. */}
        <div className="brand-surface px-5 py-4 text-center text-white print:bg-white print:text-brand-900">
          <Logo size={52} className="mx-auto mb-2" />
          <h1 className="text-lg font-bold text-gold-200 print:text-brand-900">{settings.shop_name}</h1>
          <p className="text-xs text-gold-300/80 print:text-slate-600">إيصال استلام صيانة</p>
        </div>

        <div className="p-5">
          <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 py-3 text-center">
            <p className="font-mono text-2xl font-bold tracking-wider text-brand-800">{ticket.ticket_number}</p>
            <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(ticket.received_at)}</p>
          </div>

          <dl className="space-y-1.5 text-sm">
            <Row label="الزبون" value={ticket.customer?.full_name ?? "—"} />
            <Row label="الهاتف" value={ticket.customer?.phone ?? "—"} ltr />
            <Row label="القطعة" value={ticket.item_name} />
            {ticket.karat && <Row label="العيار" value={ticket.karat} />}
            {ticket.weight_in_grams !== null && <Row label="الوزن" value={formatWeight(ticket.weight_in_grams)} />}
            <Row label="العطل" value={ticket.problem_description} />
            {ticket.estimated_cost !== null && <Row label="التكلفة التقديرية" value={formatMoney(ticket.estimated_cost)} />}
            {ticket.promised_at && <Row label="موعد التسليم" value={formatDateTime(ticket.promised_at)} />}
            {ticket.branch?.name && <Row label="الفرع" value={ticket.branch.name} />}
            {ticket.branch?.phone && <Row label="هاتف الفرع" value={ticket.branch.phone} ltr />}
          </dl>

          <div className="brand-hairline my-4" />
          <p className="text-center text-xs text-slate-500">{settings.receipt_footer}</p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-left font-medium text-slate-900" dir={ltr ? "ltr" : undefined}>{value}</dd>
    </div>
  );
}
