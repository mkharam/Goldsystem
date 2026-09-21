import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { FUNCTIONS_URL } from "@/lib/supabase";
import { REPAIR_STATUS, OPEN_STATUSES } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { Logo } from "@/components/Logo";
import type { RepairStatus } from "@/lib/types";

const STEPS: RepairStatus[] = ["received", "in_progress", "ready", "delivered"];
const POLL_MS = 20_000;

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
  feedback: { rating: number; comment: string | null } | null;
  shop_name: string;
  receipt_footer: string;
};

/** تقييم الزبون بعد التسليم: نجوم وتعليق اختياري، مرة واحدة. */
function RatingBox({ token, existing, onDone }: {
  token: string;
  existing: { rating: number; comment: string | null } | null;
  onDone: (fb: { rating: number; comment: string | null }) => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (existing) {
    return (
      <div className="mt-5 rounded-xl bg-gold-50 p-4 text-center">
        <p className="text-sm text-slate-600">شكراً لتقييمكم</p>
        <p className="mt-1 text-2xl text-gold-600" aria-label={`${existing.rating} من 5`}>
          {"★".repeat(existing.rating)}<span className="text-slate-300">{"★".repeat(5 - existing.rating)}</span>
        </p>
      </div>
    );
  }

  async function send() {
    if (rating < 1) return setErr("اختر عدد النجوم");
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment }),
      });
      if (res.ok || res.status === 409) onDone({ rating, comment: comment.trim() || null });
      else setErr("تعذّر إرسال التقييم — حاول لاحقاً");
    } catch {
      setErr("تعذّر إرسال التقييم — تحقّق من الإنترنت");
    }
    setBusy(false);
  }

  return (
    <div className="mt-5 rounded-xl border border-gold-200 bg-gold-50 p-4">
      <p className="mb-2 text-center font-semibold text-slate-800">كيف كانت تجربتك؟</p>
      <div className="flex justify-center gap-1" dir="ltr">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} نجوم`}
            className={`text-3xl transition ${n <= rating ? "text-gold-600" : "text-slate-300"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="field mt-3 min-h-[64px]"
        maxLength={500}
        placeholder="ملاحظة اختيارية"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {err && <p className="mt-2 text-center text-sm text-red-700">{err}</p>}
      <button type="button" className="btn-primary mt-3 w-full" disabled={busy} onClick={send}>
        {busy ? "جارٍ الإرسال…" : "أرسل التقييم"}
      </button>
    </div>
  );
}

export default function Track() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const prevStatus = useRef<RepairStatus | null>(null);

  const load = useCallback(
    async (silent: boolean) => {
      if (!token) return;
      try {
        // صفحة عامة: لا تمرّ بـ Supabase مباشرة — دالة track وحدها تقرّر ما يُعرض.
        const res = await fetch(`${FUNCTIONS_URL}/track?token=${encodeURIComponent(token)}`);
        if (res.status === 404 || res.status === 400) throw new Error("لم نعثر على هذه التذكرة");
        if (!res.ok) throw new Error("تعذّر تحميل حالة التذكرة");
        const next: TrackData = await res.json();

        if (silent && prevStatus.current && prevStatus.current !== next.ticket.status) {
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 2500);
          try { navigator.vibrate?.(15); } catch { /* اهتزاز اختياري فقط */ }
        }
        prevStatus.current = next.ticket.status;
        setData(next);
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : "خطأ");
      }
    },
    [token],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // تحديث دوري لطيف بدل ضغط "تحديث" يدوي — الزبون قد يترك الصفحة مفتوحة
  // وهو ينتظر. يتوقّف حين تكون التبويبة مخفية، وحين تصل الحالة لنهايتها
  // (مسلّمة/ملغاة) فلا داعي للاستمرار في الاستعلام.
  useEffect(() => {
    if (!data) return;
    const terminal = data.ticket.status === "delivered" || data.ticket.status === "cancelled";
    if (terminal) return;

    const tick = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [data, load]);

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

  const shareText = `تتبّع حالة صيانة قطعتي (${ticket.ticket_number}): ${window.location.href}`;
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: data!.shop_name, text: shareText, url: window.location.href });
        return;
      } catch {
        // المستخدم ألغى المشاركة — لا حاجة لفتح واتساب بعدها.
        return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener");
  }

  return (
    <div className="brand-surface min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-5 text-center">
          <Logo size={76} className="mx-auto mb-3 shadow-lg" />
          <h1 className="text-xl font-bold text-gold-200">{data.shop_name}</h1>
          <p className="text-sm text-gold-300/70">متابعة حالة الصيانة</p>
        </div>

        <div className="card card-enter overflow-hidden">
          {/* الحالة أولاً وبأكبر خط: الزبون يفتح الصفحة ليعرفها، لا ليقرأ تفاصيل. */}
          <div
            className={`relative px-5 py-6 text-center transition-colors duration-500 ${
              isCancelled
                ? "bg-red-50"
                : ticket.status === "ready"
                  ? "bg-brand-600 text-white"
                  : ticket.status === "delivered"
                    ? "bg-slate-100"
                    : "bg-gold-50"
            }`}
          >
            {justUpdated && (
              <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-brand-700 shadow">
                تحديث جديد
              </span>
            )}
            <p className={`text-2xl font-bold ${ticket.status === "ready" ? "text-white" : "text-brand-800"}`}>
              {isCancelled ? "أُلغيت" : REPAIR_STATUS[ticket.status].label}
            </p>
            {ticket.status === "ready" && (
              <p className="mt-1 text-sm text-brand-50">تفضّل لاستلامها من المحل</p>
            )}
            {isCancelled && <p className="mt-1 text-sm text-red-700">يرجى مراجعة المحل</p>}
          </div>

          <div className="border-b border-dashed border-slate-200 px-5 pb-4 pt-4 text-center">
            <p className="text-lg font-semibold text-slate-800">{ticket.item_name}</p>
            <p className="mt-1 font-mono text-sm text-slate-500">{ticket.ticket_number}</p>
          </div>

          <div className="p-5 pt-0">

          {isCancelled ? null : (
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
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-500 ${
                      done ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-400"
                    }`}>
                      {done ? <span className="pop-check">✓</span> : index + 1}
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

          {ticket.status === "delivered" && token && (
            <RatingBox
              token={token}
              existing={data.feedback}
              onDone={(fb) => setData((d) => (d ? { ...d, feedback: fb } : d))}
            />
          )}

            <div className="mt-5 flex gap-2">
              {ticket.branch_phone && (
                <a href={`tel:${ticket.branch_phone}`} className="btn-ghost flex-1">اتصل بالفرع</a>
              )}
              <button type="button" onClick={share} className="btn-ghost flex-1">
                مشاركة الرابط
              </button>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gold-300/60">{data.receipt_footer}</p>
      </div>
    </div>
  );
}
