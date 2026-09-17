import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/guard";
import { getTicket } from "@/lib/tickets";
import { getSettings } from "@/lib/settings";
import { qrSvg, trackingUrl } from "@/lib/qr";
import { formatDateTime, formatWeight, formatMoney } from "@/lib/format";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;

  const ticket = await getTicket(id);
  if (!ticket) notFound();

  const [settings, url] = [await getSettings(), trackingUrl(ticket.tracking_token)];
  const qr = await qrSvg(url, 150);

  return (
    <div className="mx-auto max-w-sm p-4">
      <div className="no-print mb-4 flex gap-2">
        <Link href={`/tickets/${ticket.id}`} className="btn-ghost flex-1">
          التذكرة
        </Link>
        <PrintButton />
      </div>

      <div className="card p-5 print:border-0 print:shadow-none">
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-900">{settings.shop_name}</h1>
          <p className="text-sm text-slate-500">إيصال استلام صيانة</p>
        </div>

        <div className="my-4 border-y border-dashed border-slate-300 py-3 text-center">
          <p className="font-mono text-2xl font-bold tracking-wider text-slate-900">
            {ticket.ticket_number}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(ticket.received_at)}</p>
        </div>

        <dl className="space-y-1.5 text-sm">
          <Row label="الزبون" value={ticket.customer?.full_name ?? "—"} />
          <Row label="الهاتف" value={ticket.customer?.phone ?? "—"} ltr />
          <Row label="القطعة" value={ticket.item_name} />
          {ticket.karat && <Row label="العيار" value={ticket.karat} />}
          {ticket.weight_in_grams !== null && (
            <Row label="الوزن" value={formatWeight(ticket.weight_in_grams)} />
          )}
          <Row label="العطل" value={ticket.problem_description} />
          {ticket.estimated_cost !== null && (
            <Row label="التكلفة التقديرية" value={formatMoney(ticket.estimated_cost)} />
          )}
          {ticket.promised_at && <Row label="موعد التسليم" value={formatDateTime(ticket.promised_at)} />}
          {ticket.branch?.name && <Row label="الفرع" value={ticket.branch.name} />}
        </dl>

        <div className="mt-5 flex flex-col items-center border-t border-dashed border-slate-300 pt-4">
          {/* الزبون يتابع حالة قطعته بمسح الرمز — بلا تطبيق ولا تسجيل دخول. */}
          <div dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-2 text-center text-xs text-slate-500">امسح الرمز لمتابعة حالة قطعتك</p>
          <p className="mt-1 break-all text-center text-[10px] text-slate-400" dir="ltr">
            {url}
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">{settings.receipt_footer}</p>
      </div>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-left font-medium text-slate-900" dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}
