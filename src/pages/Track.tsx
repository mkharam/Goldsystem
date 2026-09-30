import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FUNCTIONS_URL } from "@/lib/supabase";
import { REPAIR_STATUS, OPEN_STATUSES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
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
  /** بقية قطع نفس الزيارة (إيصال مجمّع). */
  siblings?: { ticket_number: string; item_name: string; status: RepairStatus; token: string }[];
  feedback: { rating: number; comment: string | null } | null;
  shop_name: string;
  receipt_footer: string;
};

/**
 * ما يقوله كل مستوى للزبون: عنوان دافئ وجملة تطمئنه. الصفحة تجربة تستحق أن يعود
 * إليها، لا جدول حالات — لذلك لغة إنسانية ورمز متحرّك لكل مرحلة.
 */
const STAGE: Record<RepairStatus, { title: string; line: string; percent: number }> = {
  received: { title: "استلمنا قطعتك بأمان", line: "قطعتك في أيدٍ أمينة، وسيبدأ الحرفي العمل عليها قريباً", percent: 25 },
  in_progress: { title: "الحرفي يعمل على قطعتك", line: "نعتني بكل تفصيلة لتعود قطعتك أجمل مما كانت", percent: 60 },
  ready: { title: "قطعتك جاهزة", line: "تفضّل لاستلامها من المحل — بانتظارك", percent: 100 },
  delivered: { title: "تم التسليم", line: "شكراً لثقتك — يسعدنا أن نخدمك دائماً", percent: 100 },
  cancelled: { title: "أُلغيت التذكرة", line: "يرجى مراجعة المحل لأي استفسار", percent: 0 },
};

/**
 * رمز ذهبي لكل مرحلة، مرسوم بخط رفيع بتدرّج ذهبي — رموز الإيموجي تظهر بألوان
 * الهاتف (خاتم بنفسجي بفص أزرق) وتكسر الطابع الذهبي للصفحة.
 */
function StageIcon({ status }: { status: RepairStatus }) {
  const common = { fill: "none", stroke: "url(#trk-gold-icon)", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 48 48" width="54" height="54" aria-hidden="true">
      <defs>
        <linearGradient id="trk-gold-icon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff6df" />
          <stop offset="55%" stopColor="#e1bb76" />
          <stop offset="100%" stopColor="#af8d51" />
        </linearGradient>
      </defs>
      {status === "received" && (
        <g {...common}>
          <circle cx="24" cy="30" r="11" />
          <path d="M18 14l3-5h6l3 5-6 6z" />
          <path d="M18 14h12" />
        </g>
      )}
      {status === "in_progress" && (
        <g {...common}>
          <path d="M24 6l3.2 9.8L37 19l-9.8 3.2L24 32l-3.2-9.8L11 19l9.8-3.2z" />
          <path d="M37 30l1.4 4.1L42.5 35.5l-4.1 1.4L37 41l-1.4-4.1-4.1-1.4 4.1-1.4z" />
          <path d="M11 32l1 2.8 2.8 1-2.8 1L11 39.6l-1-2.8-2.8-1 2.8-1z" />
        </g>
      )}
      {status === "ready" && (
        <g {...common}>
          <rect x="9" y="20" width="30" height="20" rx="2.5" />
          <path d="M7 15h34v5H7zM24 15v25" />
          <path d="M24 15c-2-5-9-7-10-3s6 3 10 3c4 0 11 1 10-3s-8-2-10 3z" />
        </g>
      )}
      {status === "delivered" && (
        <g {...common}>
          <path d="M24 40S8 30.5 8 19.5A8 8 0 0 1 24 15a8 8 0 0 1 16 4.5C40 30.5 24 40 24 40z" />
          <path d="M17.5 22.5l4.5 4.5 8.5-8.5" />
        </g>
      )}
      {status === "cancelled" && (
        <g {...common}>
          <circle cx="24" cy="24" r="15" />
          <path d="M18 18l12 12M30 18L18 30" />
        </g>
      )}
    </svg>
  );
}

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
      <div className="trk-glass trk-rise p-5 text-center">
        <p className="text-sm text-gold-200/80">شكراً لتقييمكم</p>
        <p className="mt-1 text-3xl tracking-widest text-gold-300" aria-label={`${existing.rating} من 5`}>
          {"★".repeat(existing.rating)}<span className="text-white/20">{"★".repeat(5 - existing.rating)}</span>
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
    <div className="trk-glass trk-rise p-5">
      <p className="mb-3 text-center font-semibold text-gold-100">كيف كانت تجربتك معنا؟</p>
      <div className="flex justify-center gap-1.5" dir="ltr">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} نجوم`}
            className={`trk-star text-4xl ${n <= rating ? "is-on" : ""}`}
            style={{ animationDelay: `${n * 60}ms` }}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="mt-4 min-h-[64px] w-full rounded-xl border border-gold-500/30 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-gold-400"
        maxLength={500}
        placeholder="ملاحظة اختيارية"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {err && <p className="mt-2 text-center text-sm text-red-300">{err}</p>}
      <button type="button" className="trk-btn-gold mt-3 w-full" disabled={busy} onClick={send}>
        {busy ? "جارٍ الإرسال…" : "أرسل التقييم"}
      </button>
    </div>
  );
}

/** حلقة تقدّم ذهبية تمتلئ حسب المرحلة، مع رمز المرحلة في وسطها. */
function ProgressRing({ percent, status, ready }: { percent: number; status: RepairStatus; ready: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  // تبدأ فارغة ثم تمتلئ — الحركة تجعل التقدّم محسوساً عند كل فتح.
  useEffect(() => {
    const t = setTimeout(() => setShown(percent), 120);
    return () => clearTimeout(t);
  }, [percent]);

  return (
    <div className={`trk-ring ${ready ? "is-ready" : ""}`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="trk-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5e9cf" />
            <stop offset="50%" stopColor="#d9b66a" />
            <stop offset="100%" stopColor="#a87d28" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke="url(#trk-gold)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * shown) / 100}
          style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <span key={status} className="trk-ring-icon"><StageIcon status={status} /></span>
    </div>
  );
}

/** نثار ذهبي يتساقط عند الجاهزية أو عند وصول تحديث جديد. */
function Confetti() {
  return (
    <div className="trk-confetti" aria-hidden="true">
      {Array.from({ length: 28 }).map((_, i) => (
        <span
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i % 7) * 0.12}s`,
            animationDuration: `${2.2 + (i % 5) * 0.35}s`,
            transform: `rotate(${i * 29}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export default function Track() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const [lastFetch, setLastFetch] = useState<number>(Date.now());
  const [, setNow] = useState(Date.now());
  const [lightbox, setLightbox] = useState<string | null>(null);
  const prevStatus = useRef<RepairStatus | null>(null);

  const load = useCallback(
    async (silent: boolean) => {
      if (!token) return;
      try {
        // معاينة التصميم أثناء التطوير فقط (?demo=ready …) — تُحذف من نسخة الإنتاج.
        const demo = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("demo") : null;
        if (demo) {
          const st = demo as RepairStatus;
          setData({
            ticket: {
              ticket_number: "R-26-01-0015", item_name: "خاتم ذهب بفص", status: st,
              received_at: "2026-09-27T10:00:00Z", promised_at: "2026-10-09T15:00:00Z",
              ready_at: st === "ready" || st === "delivered" ? "2026-09-30T09:00:00Z" : null,
              delivered_at: st === "delivered" ? "2026-09-30T12:00:00Z" : null,
              branch_name: "حي الأندلس", branch_phone: "0911111111",
            },
            photos: [], siblings: [], feedback: null, shop_name: "مجوهرات مخرّم",
            receipt_footer: "يرجى الاحتفاظ بهذا الإيصال لاستلام القطعة",
          });
          setLastFetch(Date.now());
          return;
        }
        // صفحة عامة: لا تمرّ بـ Supabase مباشرة — دالة track وحدها تقرّر ما يُعرض.
        const res = await fetch(`${FUNCTIONS_URL}/track?token=${encodeURIComponent(token)}`);
        if (res.status === 404 || res.status === 400) throw new Error("لم نعثر على هذه التذكرة");
        if (!res.ok) throw new Error("تعذّر تحميل حالة التذكرة");
        const next: TrackData = await res.json();

        if (silent && prevStatus.current && prevStatus.current !== next.ticket.status) {
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 4000);
          try { navigator.vibrate?.([20, 60, 20]); } catch { /* اهتزاز اختياري فقط */ }
        }
        prevStatus.current = next.ticket.status;
        setData(next);
        setLastFetch(Date.now());
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : "خطأ");
      }
    },
    [token],
  );

  useEffect(() => {
    prevStatus.current = null;
    setData(null);
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

  // عدّاد «آخر تحديث قبل …» — يُشعر الزبون أن الصفحة حيّة.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (error) {
    return (
      <div className="trk-bg flex min-h-dvh items-center justify-center px-4">
        <Aurora />
        <div className="trk-glass trk-rise relative p-8 text-center">
          <Logo size={64} className="mx-auto mb-4" />
          <p className="text-gold-100">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="trk-bg flex min-h-dvh flex-col items-center justify-center gap-4">
        <Aurora />
        <div className="trk-logo-halo"><Logo size={84} /></div>
        <p className="trk-shimmer-text relative text-sm">جارٍ جلب حالة قطعتك…</p>
      </div>
    );
  }

  const { ticket } = data;
  const currentStep = STEPS.indexOf(ticket.status);
  const isCancelled = ticket.status === "cancelled";
  const isReady = ticket.status === "ready";
  const stage = STAGE[ticket.status];
  const open = OPEN_STATUSES.includes(ticket.status) && !isReady;
  const late = open && !!ticket.promised_at && new Date(ticket.promised_at).getTime() < Date.now();
  const seconds = Math.max(0, Math.round((Date.now() - lastFetch) / 1000));
  const live = !isCancelled && ticket.status !== "delivered";

  const shareText = `تتبّع حالة صيانة قطعتي (${ticket.ticket_number}): ${window.location.href}`;
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: data!.shop_name, text: shareText, url: window.location.href });
      } catch {
        // المستخدم ألغى المشاركة — لا حاجة لفتح واتساب بعدها.
      }
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener");
  }

  const stamps: Partial<Record<RepairStatus, string | null>> = {
    received: ticket.received_at,
    ready: ticket.ready_at,
    delivered: ticket.delivered_at,
  };

  return (
    // لكل مرحلة هوية: ألوان الوهج وحركة الرمز تتغيّر (راجع ‎[data-stage]‎ في index.css).
    <div className="trk-bg min-h-dvh px-4 pb-10 pt-8" data-stage={ticket.status}>
      <Aurora />
      {ticket.status === "delivered" && <Hearts />}
      {(isReady || justUpdated) && <Confetti key={`${ticket.status}-${justUpdated}`} />}

      <div className="relative mx-auto max-w-md space-y-4">
        {/* الهوية: شعار بهالة ذهبية دوّارة واسم المحل بلمعة متحرّكة */}
        <header className="trk-rise text-center">
          <div className="trk-logo-halo mx-auto mb-3"><Logo size={76} /></div>
          <h1 className="trk-shop">{data.shop_name}</h1>
          <p className="mt-1 text-xs tracking-[0.25em] text-gold-300/70">متابعة الصيانة</p>
        </header>

        {/* الحالة — القلب: حلقة تقدّم، عنوان دافئ، ومؤشّر «مباشر» */}
        <section className={`trk-glass trk-rise relative overflow-hidden p-6 text-center ${isReady ? "trk-ready-glow" : ""}`}
          style={{ animationDelay: "80ms" }}>
          {justUpdated && <span className="trk-badge-new">تحديث جديد ✨</span>}
          {!isCancelled && <ProgressRing percent={stage.percent} status={ticket.status} ready={isReady} />}
          <h2 key={ticket.status} className={`trk-status-title ${isCancelled ? "text-red-200" : ""}`}>{stage.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-gold-100/80">{stage.line}</p>

          {live && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold-500/25 bg-white/5 px-3 py-1 text-[11px] text-gold-200/80">
              <span className="trk-live-dot" />
              مباشر · {seconds < 5 ? "مُحدَّث الآن" : `آخر تحديث قبل ${seconds} ث`}
            </p>
          )}
        </section>

        {/* القطعة */}
        <section className="trk-glass trk-rise p-5" style={{ animationDelay: "160ms" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gold-300/70">القطعة</p>
              <p className="truncate text-lg font-bold text-white">{ticket.item_name}</p>
            </div>
            <span className="shrink-0 rounded-lg border border-gold-500/30 bg-gold-500/10 px-2.5 py-1 font-mono text-xs text-gold-200" dir="ltr">
              {ticket.ticket_number}
            </span>
          </div>

          {data.photos.length > 0 && (
            <div className="-mx-1 mt-4 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
              {data.photos.map((src, i) => (
                <button key={i} type="button" onClick={() => setLightbox(src)}
                  className="trk-photo snap-start" style={{ animationDelay: `${200 + i * 80}ms` }}>
                  <img src={src} alt="صورة القطعة" />
                </button>
              ))}
            </div>
          )}

          {/* الموعد تقديري دائماً — لا نعِد به. وإن فات ولم تجهز القطعة نقول ذلك صراحةً
              حتى لا يأتي الزبون على الموعد ويجدها غير جاهزة: ينتظر رسالة الجاهزية. */}
          {open && (
            late ? (
              <div className="mt-4 rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-center">
                <p className="font-semibold text-gold-100">قطعتك تحتاج وقتاً إضافياً قليلاً</p>
                <p className="mt-1 text-sm text-gold-100/70">
                  نرجو عدم الحضور قبل أن تصلك رسالة واتساب بجاهزيتها، أو تظهر هنا «قطعتك جاهزة».
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-white/5 px-4 py-3 text-center">
                {ticket.promised_at && (
                  <p className="text-sm text-gold-100">
                    الموعد التقريبي للجاهزية: <span className="font-bold text-gold-300">{formatDate(ticket.promised_at)}</span>
                  </p>
                )}
                <p className="mt-1 text-xs text-gold-100/60">
                  {ticket.promised_at ? "الموعد تقديري — " : ""}سنبلغك عبر واتساب فور جهوز القطعة.
                </p>
              </div>
            )
          )}
        </section>

        {/* الرحلة: خط ذهبي يمتلئ حتى المرحلة الحالية */}
        {!isCancelled && (
          <section className="trk-glass trk-rise p-5" style={{ animationDelay: "240ms" }}>
            <p className="mb-4 text-xs tracking-widest text-gold-300/70">رحلة قطعتك</p>
            <ol className="trk-timeline" style={{ ["--fill-ratio" as string]: Math.max(0, currentStep) / (STEPS.length - 1) }}>
              {STEPS.map((step, index) => {
                const done = index < currentStep;
                const active = index === currentStep;
                const stamp = stamps[step];
                return (
                  <li key={step} className={`trk-step ${done ? "is-done" : ""} ${active ? "is-active" : ""}`}
                    style={{ animationDelay: `${300 + index * 90}ms` }}>
                    <span className="trk-dot">{done || (active && step === "delivered") ? "✓" : index + 1}</span>
                    <div>
                      <p className="trk-step-label">{REPAIR_STATUS[step].label}</p>
                      {stamp && (done || active) && <p className="text-[11px] text-gold-100/50">{formatDate(stamp)}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {(data.siblings?.length ?? 0) > 0 && (
          <section className="trk-glass trk-rise p-5" style={{ animationDelay: "320ms" }}>
            <p className="mb-3 text-xs tracking-widest text-gold-300/70">بقية قطعك في نفس الإيصال</p>
            <div className="space-y-2">
              {data.siblings!.map((s) => (
                <Link key={s.token} to={`/track/${s.token}`} className="trk-sibling">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-white">{s.item_name}</span>
                    <span className="block font-mono text-[11px] text-gold-200/60" dir="ltr">{s.ticket_number}</span>
                  </span>
                  <span className={`trk-pill ${s.status === "ready" ? "is-ready" : ""}`}>{REPAIR_STATUS[s.status].label}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {ticket.status === "delivered" && token && (
          <RatingBox
            token={token}
            existing={data.feedback}
            onDone={(fb) => setData((d) => (d ? { ...d, feedback: fb } : d))}
          />
        )}

        <div className="trk-rise flex gap-2" style={{ animationDelay: "400ms" }}>
          {ticket.branch_phone && (
            <a href={`tel:${ticket.branch_phone}`} className="trk-btn-ghost flex-1">اتصل بالمحل</a>
          )}
          <button type="button" onClick={share} className="trk-btn-gold flex-1">مشاركة</button>
        </div>

        {data.receipt_footer && (
          <p className="pt-2 text-center text-[11px] text-gold-300/50">{data.receipt_footer}</p>
        )}
      </div>

      {lightbox && (
        <button type="button" className="trk-lightbox" onClick={() => setLightbox(null)} aria-label="إغلاق">
          <img src={lightbox} alt="صورة القطعة" />
        </button>
      )}
    </div>
  );
}

/** قلوب ذهبية تصعد ببطء بعد التسليم — شكر هادئ. */
function Hearts() {
  return (
    <div className="trk-hearts" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} style={{ left: `${8 + ((i * 41) % 84)}%`, animationDelay: `${i * 0.9}s` }}>♥</span>
      ))}
    </div>
  );
}

/** خلفية حيّة: وهج ذهبي وزمرّدي يتحرّك ببطء، ونجوم صغيرة تلمع. */
function Aurora() {
  return (
    <div className="trk-aurora" aria-hidden="true">
      <span className="a1" />
      <span className="a2" />
      <span className="a3" />
      {Array.from({ length: 18 }).map((_, i) => (
        <i key={i} style={{
          left: `${(i * 53) % 100}%`,
          top: `${(i * 31) % 100}%`,
          animationDelay: `${(i % 6) * 0.7}s`,
        }} />
      ))}
    </div>
  );
}
