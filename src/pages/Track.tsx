import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FUNCTIONS_URL } from "@/lib/supabase";
import { REPAIR_STATUS, OPEN_STATUSES } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { Logo } from "@/components/Logo";
import type { RepairStatus } from "@/lib/types";

const STEPS: RepairStatus[] = ["received", "in_progress", "ready", "delivered"];

type TrackData = {
  ticket: {
    ticket_number: string;
    item_name: string;
    status: RepairStatus;
    received_at: string;
    promised_at: string | null;
    ready_at: string | null;
    delivered_at: string | null;
    branch_name: string | null;
    branch_phone: string | null;
  };
  photos: string[];
  shop_name: string;
  receipt_footer: string;
};

export default function Track() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // صفحة عامة: لا تمرّ بـ Supabase مباشرة — دالة track وحدها تقرّر ما يُعرض.
    fetch(`${FUNCTIONS_URL}/track?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404 || res.status === 400) throw new Error("لم نعثر على هذه التذكرة");
        if (!res.ok) throw new Error("تعذّر تحميل حالة التذكرة");
        setData(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : "خطأ"));
  }, [token]);

  if (error) {
    return (
      <div className="brand-surface flex min-h-dvh items-center justify-center px-4">
        <p className="card p-6 text-center text-slate-600">{error}</p>
      </div>
    );
  }

  if (!data) {
    return <div className="brand-surface flex min-h-dvh items-center justify-center text-gold-300/70">جارٍ التحميل…</div>;
  }

  const { ticket } = data;
  const currentStep = STEPS.indexOf(ticket.status);
  const isCancelled = ticket.status === "cancelled";

  return (
    <div className="brand-surface min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-5 text-center">
          <Logo size={76} className="mx-auto mb-3 shadow-lg" />
          <h1 className="text-xl font-bold text-gold-200">{data.shop_name}</h1>
          <p className="text-sm text-gold-300/70">متابعة حالة الصيانة</p>
        </div>

        <div className="card p-5">
          <div className="border-b border-dashed border-slate-200 pb-4 text-center">
            <p className="font-mono text-xl font-bold text-brand-800">{ticket.ticket_number}</p>
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
                const stamp =
                  step === "received" ? ticket.received_at
                  : step === "ready" ? ticket.ready_at
                  : step === "delivered" ? ticket.delivered_at
                  : null;

                return (
                  <li key={step} className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      done ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-400"
                    }`}>
                      {done ? "✓" : index + 1}
                    </span>
                    <div>
                      <p className={`font-medium ${active ? "text-brand-700" : done ? "text-slate-700" : "text-slate-400"}`}>
                        {REPAIR_STATUS[step].label}
                      </p>
                      {stamp && <p className="text-xs text-slate-500">{formatDate(stamp)}</p>}
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

          {data.photos.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-3 gap-2">
                {data.photos.map((src, i) => (
                  <img key={i} src={src} alt="صورة القطعة"
                    className="aspect-square w-full rounded-lg border border-slate-200 object-cover" />
                ))}
              </div>
            </div>
          )}

          {ticket.branch_phone && (
            <a href={`tel:${ticket.branch_phone}`} className="btn-ghost mt-5 w-full">اتصل بالفرع</a>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gold-300/60">{data.receipt_footer}</p>
      </div>
    </div>
  );
}
