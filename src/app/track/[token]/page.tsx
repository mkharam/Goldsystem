import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTicketByToken, getPhotos } from "@/lib/tickets";
import { signedPhotoUrls } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/format";
import { REPAIR_STATUS, OPEN_STATUSES } from "@/lib/constants";
import type { RepairStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// صفحة عامة لكنها تخصّ زبوناً بعينه — لا يجوز أن تُفهرس في محركات البحث.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const STEPS: RepairStatus[] = ["received", "in_progress", "ready", "delivered"];

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ticket = await getTicketByToken(token);
  if (!ticket) notFound();

  const settings = await getSettings();
  // الزبون يرى صور الاستلام والتسليم فقط — لا صور العمل الداخلي.
  const photos = await getPhotos(ticket.id, true);
  const urls = await signedPhotoUrls(photos.map((p) => p.storage_path));

  const currentStep = STEPS.indexOf(ticket.status);
  const isCancelled = ticket.status === "cancelled";

  return (
    <div className="min-h-dvh bg-gradient-to-b from-gold-50 to-slate-100 px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-5 text-center">
          <h1 className="text-xl font-bold text-slate-900">{settings.shop_name}</h1>
          <p className="text-sm text-slate-500">متابعة حالة الصيانة</p>
        </div>

        <div className="card p-5">
          <div className="border-b border-dashed border-slate-200 pb-4 text-center">
            <p className="font-mono text-xl font-bold text-slate-900">{ticket.ticket_number}</p>
            <p className="mt-1 text-slate-700">{ticket.item_name}</p>
          </div>

          {isCancelled ? (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-3 text-center text-sm font-medium text-red-700">
              أُلغيت هذه التذكرة — يرجى مراجعة المحل
            </p>
          ) : (
            <ol className="mt-5 space-y-4">
              {STEPS.map((step, index) => {
                const done = index <= currentStep;
                const active = index === currentStep;
                return (
                  <li key={step} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        done ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <div>
                      <p className={`font-medium ${active ? "text-brand-700" : done ? "text-slate-700" : "text-slate-400"}`}>
                        {REPAIR_STATUS[step].label}
                      </p>
                      {step === "received" && (
                        <p className="text-xs text-slate-500">{formatDate(ticket.received_at)}</p>
                      )}
                      {step === "ready" && ticket.ready_at && (
                        <p className="text-xs text-slate-500">{formatDate(ticket.ready_at)}</p>
                      )}
                      {step === "delivered" && ticket.delivered_at && (
                        <p className="text-xs text-slate-500">{formatDate(ticket.delivered_at)}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {ticket.status === "ready" && (
            <p className="mt-5 rounded-lg bg-brand-50 px-3 py-3 text-center text-sm font-semibold text-brand-800">
              قطعتك جاهزة للاستلام
            </p>
          )}

          {OPEN_STATUSES.includes(ticket.status) && ticket.promised_at && ticket.status !== "ready" && (
            <p className="mt-5 text-center text-sm text-slate-600">
              الموعد المتوقّع للتسليم: {formatDateTime(ticket.promised_at)}
            </p>
          )}

          {photos.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={photo.id}
                    src={urls[photo.storage_path]}
                    alt="صورة القطعة"
                    className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          {ticket.branch?.phone && (
            <a href={`tel:${ticket.branch.phone}`} className="btn-ghost mt-5 w-full">
              اتصل بالفرع
            </a>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">{settings.receipt_footer}</p>
      </div>
    </div>
  );
}
