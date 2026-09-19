import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth";
import { supabase, signedPhotoUrls, PHOTO_BUCKET } from "@/lib/supabase";
import {
  getTicket, getStatusHistory, getPhotos, transitionTicket, getSettings,
  toleranceFrom, checkWeight, type Settings,
} from "@/lib/tickets";
import { REPAIR_STATUS, PHOTO_STAGE, ALLOWED_TRANSITIONS, PRIMARY_NEXT, OPEN_STATUSES, normalizeDigits, phoneDigits } from "@/lib/constants";
import { formatDateTime, formatWeight, formatMoney, overdueLabel, daysFromNow } from "@/lib/format";
import { trackingUrl } from "@/lib/qr";
import type { RepairStatus, TicketWithRelations, StatusHistoryEntry, RepairPhoto } from "@/lib/types";

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { staff } = useAuth();

  const [ticket, setTicket] = useState<TicketWithRelations | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [photos, setPhotos] = useState<RepairPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const [target, setTarget] = useState<RepairStatus | null>(null);
  const [weightOut, setWeightOut] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [finalCost, setFinalCost] = useState("");
  const [note, setNote] = useState("");
  const [deliveredTo, setDeliveredTo] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [acceptVariance, setAcceptVariance] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const [t, h, p, s] = await Promise.all([getTicket(id), getStatusHistory(id), getPhotos(id), getSettings()]);
    setTicket(t);
    setHistory(h);
    setPhotos(p);
    setSettings(s);
    setUrls(await signedPhotoUrls(p.map((x) => x.storage_path)));
    setDeliveredTo(t?.customer?.full_name ?? "");
    setLoading(false);
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  if (loading) return <AppShell><p className="text-center text-slate-400">جارٍ التحميل…</p></AppShell>;
  if (!ticket) return <AppShell><p className="card p-6 text-center text-slate-500">التذكرة غير موجودة</p></AppShell>;

  const tolerance = settings ? toleranceFrom(settings) : 0.05;
  const isOpen = OPEN_STATUSES.includes(ticket.status);
  const days = daysFromNow(ticket.promised_at);
  const isOverdue = isOpen && days !== null && days < 0;

  const variance =
    ticket.weight_in_grams !== null && ticket.weight_out_grams !== null
      ? Number((ticket.weight_out_grams - ticket.weight_in_grams).toFixed(3))
      : null;

  // فرق الوزن يُحسب أثناء الكتابة ليراه الموظف قبل الإرسال؛ القرار النهائي في
  // transitionTicket، وهذا عرض مساعد لا تحقّق.
  const liveCheck =
    ticket.weight_in_grams !== null && weightOut.trim() && Number.isFinite(Number(weightOut))
      ? checkWeight(ticket.weight_in_grams, Number(weightOut), tolerance)
      : null;

  const track = trackingUrl(ticket.tracking_token);

  const primaryNext = PRIMARY_NEXT[ticket.status];
  const otherOptions = ALLOWED_TRANSITIONS[ticket.status].filter((o) => o !== primaryNext?.to);

  async function onTransition() {
    if (!target || !staff || !ticket) return;
    setBusy(true);
    setActionError(null);

    const result = await transitionTicket({
      ticketId: ticket.id,
      to: target,
      staffId: staff.staff_id,
      tolerance,
      note: note.trim() || null,
      workDone: target === "ready" ? workDone.trim() || null : undefined,
      finalCost: target === "ready" && finalCost.trim() ? Number(normalizeDigits(finalCost)) : undefined,
      weightOut: target === "delivered" && weightOut.trim() ? Number(normalizeDigits(weightOut)) : undefined,
      deliveredToName: deliveredTo.trim() || null,
      varianceNote: varianceNote.trim() || null,
      acceptVariance,
    });

    if (!result.ok) {
      setActionError(result.error);
      setBusy(false);
      return;
    }

    setTarget(null);
    setWeightOut(""); setWorkDone(""); setFinalCost(""); setNote(""); setVarianceNote(""); setAcceptVariance(false);
    await reload();
    setBusy(false);
  }

  async function notifyWhatsApp() {
    if (!ticket || !staff) return;
    const body =
      ticket.status === "ready"
        ? `قطعتكم (${ticket.item_name}) جاهزة للاستلام.`
        : ticket.status === "delivered"
          ? `تم تسليم قطعتكم (${ticket.item_name}). شكراً لثقتكم.`
          : `تحديث بخصوص قطعتكم (${ticket.item_name}) قيد الصيانة لدينا.`;

    const message = [
      `السلام عليكم ${ticket.customer?.full_name ?? ""}،`,
      body,
      `رقم التذكرة: ${ticket.ticket_number}`,
      `لمتابعة الحالة: ${track}`,
      settings?.shop_name ?? "",
    ].join("\n");

    // نفتح واتساب فوراً؛ السجل أثر جانبي لا يجوز أن يؤخّر الموظف.
    window.open(`https://wa.me/${phoneDigits(ticket.customer?.phone ?? "")}?text=${encodeURIComponent(message)}`, "_blank", "noopener");

    await supabase.from("repair_notifications").insert({
      ticket_id: ticket.id,
      channel: "whatsapp",
      phone: ticket.customer?.phone ?? null,
      message_preview: message.slice(0, 300),
      sent_by: staff.staff_id,
    });
  }

  async function addPhotos(fileList: FileList | null, stage: "progress" | "delivery") {
    if (!fileList || !ticket || !staff) return;
    for (const file of Array.from(fileList)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${ticket.id}/${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
        contentType: file.type || "image/jpeg",
      });
      if (error) continue;
      await supabase.from("repair_photos").insert({
        ticket_id: ticket.id,
        storage_path: path,
        stage,
        uploaded_by: staff.staff_id,
        is_public: stage !== "progress",
      });
    }
    await reload();
  }

  return (
    <AppShell>
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

      {/* ——— الإجراءات ——— */}
      {ALLOWED_TRANSITIONS[ticket.status].length > 0 && (
        <section className="card mb-4 p-4">
          {!target ? (
            <>
              {/* الخطوة الطبيعية كزر واحد كبير؛ الباقي مطوي حتى لا يختار
                  الموظف من قائمة في كل مرة وهو أمام الزبون. */}
              {primaryNext && (
                <button
                  type="button"
                  onClick={() => { setTarget(primaryNext.to); setActionError(null); }}
                  className="btn-success w-full py-4 text-base"
                >
                  {primaryNext.label}
                </button>
              )}

              {otherOptions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowOther((v) => !v)}
                  className="mt-2 w-full text-center text-sm text-slate-500 hover:text-slate-700"
                >
                  {showOther ? "إخفاء الخيارات" : "خيارات أخرى"}
                </button>
              )}

              <div className={`grid gap-2 ${showOther ? "mt-2" : "hidden"}`}>
                {otherOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => { setTarget(option); setActionError(null); }}
                    className={option === "cancelled" ? "btn-ghost py-3 text-red-700" : "btn-ghost py-3"}
                  >
                    {option === "cancelled" ? "إلغاء التذكرة" : REPAIR_STATUS[option].label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">
                  {target === "delivered" ? "تسليم القطعة" : REPAIR_STATUS[target].label}
                </h2>
                <button type="button" onClick={() => setTarget(null)} className="text-sm text-slate-500 hover:underline">
                  إلغاء
                </button>
              </div>

              <div className="space-y-3">
                {target === "ready" && (
                  <>
                    <div>
                      <label className="label" htmlFor="work_done">ما تم تنفيذه</label>
                      <textarea id="work_done" rows={2} className="field" value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
                    </div>
                    <div>
                      <label className="label" htmlFor="final_cost">التكلفة النهائية</label>
                      <input id="final_cost" type="text" inputMode="decimal" dir="ltr" className="field text-left"
                        value={finalCost} onChange={(e) => setFinalCost(normalizeDigits(e.target.value))} />
                    </div>
                  </>
                )}

                {target === "delivered" && (
                  <>
                    {ticket.weight_in_grams !== null && (
                      <div>
                        <label className="label" htmlFor="weight_out">الوزن عند التسليم (غرام)</label>
                        <input id="weight_out" type="text" inputMode="decimal" dir="ltr" className="field text-left"
                          placeholder="0.000" value={weightOut} onChange={(e) => setWeightOut(normalizeDigits(e.target.value))} />
                        <p className="mt-1 text-xs text-slate-500">
                          وزن الاستلام كان {ticket.weight_in_grams.toFixed(3)} غ — المسموح ±{tolerance} غ
                        </p>

                        {liveCheck && (
                          <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${
                            liveCheck.withinTolerance ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700"
                          }`}>
                            الفرق: {liveCheck.difference > 0 ? "+" : ""}{liveCheck.difference.toFixed(3)} غ
                            {liveCheck.withinTolerance ? " — ضمن المسموح" : " — يتجاوز المسموح"}
                          </div>
                        )}

                        {liveCheck && !liveCheck.withinTolerance && (
                          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
                            <label className="flex items-start gap-2 text-sm text-red-800">
                              <input type="checkbox" className="mt-1" checked={acceptVariance}
                                onChange={(e) => setAcceptVariance(e.target.checked)} />
                              <span>أؤكّد التسليم رغم فرق الوزن</span>
                            </label>
                            <input className="field mt-2" placeholder="سبب الفرق (مثال: استبدال فص، إزالة لحام)"
                              value={varianceNote} onChange={(e) => setVarianceNote(e.target.value)} />
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="label" htmlFor="delivered_to">سُلّمت إلى</label>
                      <input id="delivered_to" className="field" value={deliveredTo} onChange={(e) => setDeliveredTo(e.target.value)} />
                    </div>
                  </>
                )}

                <div>
                  <label className="label" htmlFor="note">ملاحظة</label>
                  <input id="note" className="field" placeholder="اختياري" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>

                {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}

                <button type="button" onClick={onTransition} className="btn-success w-full py-3" disabled={busy}>
                  {busy && <span className="spinner" />}
                  {busy ? "جارٍ الحفظ…" : target === "delivered" ? "تأكيد التسليم" : `تغيير إلى ${REPAIR_STATUS[target].label}`}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold text-slate-900">الزبون</h2>
        <p className="text-slate-900">{ticket.customer?.full_name ?? "—"}</p>
        <p className="text-sm text-slate-500" dir="ltr">{ticket.customer?.phone ?? "—"}</p>
        {ticket.customer?.phone && (
          <button type="button" onClick={notifyWhatsApp} className="btn-success mt-3 w-full">
            إبلاغ الزبون عبر واتساب
          </button>
        )}
      </section>

      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-bold text-slate-900">القطعة</h2>
        <dl className="space-y-1.5 text-sm">
          {ticket.item_code && <Row label="الكود" value={ticket.item_code} />}
          {ticket.item_type && <Row label="النوع" value={ticket.item_type} />}
          {ticket.karat && <Row label="العيار" value={ticket.karat} />}
          <Row label="الوزن عند الاستلام" value={formatWeight(ticket.weight_in_grams)} />
          {ticket.weight_out_grams !== null && <Row label="الوزن عند التسليم" value={formatWeight(ticket.weight_out_grams)} />}
          <Row label="المصدر" value={ticket.item_source === "inventory" ? "من المخزون" : "إدخال يدوي"} />
        </dl>

        {variance !== null && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            Math.abs(variance) <= tolerance ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700"
          }`}>
            فرق الوزن: {variance > 0 ? "+" : ""}{variance.toFixed(3)} غ (المسموح ±{tolerance} غ)
            {ticket.weight_variance_note && (
              <span className="mt-1 block text-xs opacity-80">{ticket.weight_variance_note}</span>
            )}
          </div>
        )}
      </section>

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
          {ticket.final_cost !== null && <Row label="التكلفة النهائية" value={formatMoney(ticket.final_cost)} />}
          <Row label="الاستلام" value={formatDateTime(ticket.received_at)} />
          <Row label="موعد التسليم" value={formatDateTime(ticket.promised_at)} />
          {ticket.delivered_at && <Row label="سُلّمت" value={formatDateTime(ticket.delivered_at)} />}
          {ticket.received_by_staff && <Row label="استلمها" value={ticket.received_by_staff.full_name} />}
        </dl>
      </section>


      {/* ——— الصور ——— */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 font-bold text-slate-900">الصور</h2>
        {photos.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد صور</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <a key={photo.id} href={urls[photo.storage_path]} target="_blank" rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-slate-200">
                <img src={urls[photo.storage_path]} alt={PHOTO_STAGE[photo.stage]} className="aspect-square w-full object-cover" />
                <span className="block bg-slate-50 px-1 py-0.5 text-center text-[10px] text-slate-500">
                  {PHOTO_STAGE[photo.stage]}
                </span>
              </a>
            ))}
          </div>
        )}

        {isOpen && (
          <label className="btn-ghost mt-3 w-full cursor-pointer">
            إضافة صور أثناء العمل
            <input type="file" accept="image/*" capture="environment" multiple className="hidden"
              onChange={(e) => addPhotos(e.target.files, "progress")} />
          </label>
        )}
      </section>

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
        <Link to={`/tickets/${ticket.id}/receipt`} className="btn-ghost flex-1">الإيصال</Link>
        <a href={track} target="_blank" rel="noreferrer" className="btn-ghost flex-1">صفحة التتبّع</a>
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
