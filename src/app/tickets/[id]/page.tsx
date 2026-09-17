import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/guard";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { getTicket, getStatusHistory, getPhotos } from "@/lib/tickets";
import { signedPhotoUrls } from "@/lib/db";
import { getWeightTolerance, getSettings } from "@/lib/settings";
import { trackingUrl } from "@/lib/qr";
import { formatDateTime, formatWeight, formatMoney, overdueLabel, daysFromNow } from "@/lib/format";
import { REPAIR_STATUS, PHOTO_STAGE, ALLOWED_TRANSITIONS, OPEN_STATUSES } from "@/lib/constants";
import { StatusActions } from "./StatusActions";
import { NotifyButton } from "./NotifyButton";
import { PhotoUploader } from "./PhotoUploader";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;

  const ticket = await getTicket(id);
  if (!ticket) notFound();

  const [history, photos, tolerance, settings] = await Promise.all([
    getStatusHistory(id),
    getPhotos(id),
    getWeightTolerance(),
    getSettings(),
  ]);

  const urls = await signedPhotoUrls(photos.map((p) => p.storage_path));
  const track = trackingUrl(ticket.tracking_token);

  const days = daysFromNow(ticket.promised_at);
  const isOpen = OPEN_STATUSES.includes(ticket.status);
  const isOverdue = isOpen && days !== null && days < 0;

  const variance =
    ticket.weight_in_grams !== null && ticket.weight_out_grams !== null
      ? Number((ticket.weight_out_grams - ticket.weight_in_grams).toFixed(3))
      : null;

  return (
    <AppShell staff={staff}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-slate-500">{ticket.ticket_number}</p>
          <h1 className="text-lg font-bold text-slate-900">{ticket.item_name}</h1>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      {isOverdue && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
          {overdueLabel(ticket.promised_at)} — موعدها {formatDateTime(ticket.promised_at)}
        </p>
      )}

      {/* ——— الزبون ——— */}
      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold text-slate-900">الزبون</h2>
        <p className="text-slate-900">{ticket.customer?.full_name ?? "—"}</p>
        <p className="text-sm text-slate-500" dir="ltr">
          {ticket.customer?.phone ?? "—"}
        </p>

        {ticket.customer?.phone && (
          <NotifyButton
            ticketId={ticket.id}
            phone={ticket.customer.phone}
            customerName={ticket.customer.full_name}
            ticketNumber={ticket.ticket_number}
            itemName={ticket.item_name}
            status={ticket.status}
            shopName={settings.shop_name}
            trackUrl={track}
          />
        )}
      </section>

      {/* ——— القطعة ——— */}
      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold text-slate-900">القطعة</h2>
        <dl className="space-y-1.5 text-sm">
          {ticket.item_code && <Row label="الكود" value={ticket.item_code} />}
          {ticket.item_type && <Row label="النوع" value={ticket.item_type} />}
          {ticket.karat && <Row label="العيار" value={ticket.karat} />}
          <Row label="الوزن عند الاستلام" value={formatWeight(ticket.weight_in_grams)} />
          {ticket.weight_out_grams !== null && (
            <Row label="الوزن عند التسليم" value={formatWeight(ticket.weight_out_grams)} />
          )}
          <Row
            label="المصدر"
            value={ticket.item_source === "inventory" ? "من المخزون" : "إدخال يدوي"}
          />
        </dl>

        {variance !== null && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              Math.abs(variance) <= tolerance
                ? "bg-brand-50 text-brand-800"
                : "bg-red-50 text-red-700"
            }`}
          >
            فرق الوزن: {variance > 0 ? "+" : ""}
            {variance.toFixed(3)} غ (المسموح ±{tolerance} غ)
            {ticket.weight_variance_note && (
              <span className="mt-1 block text-xs opacity-80">{ticket.weight_variance_note}</span>
            )}
          </div>
        )}
      </section>

      {/* ——— العمل ——— */}
      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold text-slate-900">العمل المطلوب</h2>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{ticket.problem_description}</p>

        {ticket.work_done && (
          <>
            <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-900">ما تم تنفيذه</h3>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{ticket.work_done}</p>
          </>
        )}

        <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <Row label="التكلفة التقديرية" value={formatMoney(ticket.estimated_cost)} />
          {ticket.final_cost !== null && (
            <Row label="التكلفة النهائية" value={formatMoney(ticket.final_cost)} />
          )}
          <Row label="الاستلام" value={formatDateTime(ticket.received_at)} />
          <Row label="موعد التسليم" value={formatDateTime(ticket.promised_at)} />
          {ticket.delivered_at && <Row label="سُلّمت" value={formatDateTime(ticket.delivered_at)} />}
          {ticket.received_by_staff && <Row label="استلمها" value={ticket.received_by_staff.full_name} />}
        </dl>
      </section>

      {/* ——— الإجراءات ——— */}
      {ALLOWED_TRANSITIONS[ticket.status].length > 0 && (
        <StatusActions
          ticketId={ticket.id}
          status={ticket.status}
          weightIn={ticket.weight_in_grams}
          tolerance={tolerance}
          customerName={ticket.customer?.full_name ?? ""}
        />
      )}

      {/* ——— الصور ——— */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 font-bold text-slate-900">الصور</h2>

        {photos.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد صور</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <a
                key={photo.id}
                href={urls[photo.storage_path]}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-slate-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={urls[photo.storage_path]}
                  alt={photo.caption ?? PHOTO_STAGE[photo.stage]}
                  className="aspect-square w-full object-cover"
                />
                <span className="block bg-slate-50 px-1 py-0.5 text-center text-[10px] text-slate-500">
                  {PHOTO_STAGE[photo.stage]}
                </span>
              </a>
            ))}
          </div>
        )}

        {isOpen && <PhotoUploader ticketId={ticket.id} />}
      </section>

      {/* ——— السجل ——— */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 font-bold text-slate-900">السجل</h2>
        <ol className="space-y-3">
          {history.map((entry) => (
            <li key={entry.id} className="flex gap-3 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${REPAIR_STATUS[entry.to_status].dot}`} />
              <div>
                <p className="font-medium text-slate-900">{REPAIR_STATUS[entry.to_status].label}</p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(entry.created_at)}
                  {entry.staff?.full_name && ` · ${entry.staff.full_name}`}
                </p>
                {entry.note && <p className="mt-0.5 text-xs text-slate-600">{entry.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex gap-2">
        <Link href={`/tickets/${ticket.id}/receipt`} className="btn-ghost flex-1">
          الإيصال
        </Link>
        <a href={track} target="_blank" rel="noreferrer" className="btn-ghost flex-1">
          صفحة التتبّع
        </a>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-left font-medium text-slate-900">{value}</dd>
    </div>
  );
}
