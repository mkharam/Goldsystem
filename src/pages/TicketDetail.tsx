import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { buzz } from "@/lib/haptics";
import { supabase, signedPhotoUrls, PHOTO_BUCKET } from "@/lib/supabase";
import {
  getTicket, getStatusHistory, getPhotos, transitionTicket, getSettings, updateTicketDetails,
  toleranceFrom, checkWeight, type Settings,
} from "@/lib/tickets";
import { REPAIR_STATUS, PHOTO_STAGE, ALLOWED_TRANSITIONS, PRIMARY_NEXT, OPEN_STATUSES, KARAT_OPTIONS, ITEM_TYPE_OPTIONS, normalizeDigits } from "@/lib/constants";
import { formatDateTime, formatWeight, formatMoney, overdueLabel, daysFromNow } from "@/lib/format";
import { trackingUrl } from "@/lib/qr";
import { compressImages, makeThumbnail } from "@/lib/image";
import { notifyCustomer, defaultKind } from "@/lib/whatsapp";
import type { RepairStatus, TicketWithRelations, StatusHistoryEntry, RepairPhoto } from "@/lib/types";

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { staff } = useAuth();
  const toast = useToast();

  const [ticket, setTicket] = useState<TicketWithRelations | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [photos, setPhotos] = useState<RepairPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  // هل أُبلغ الزبون بأن القطعة جاهزة؟ (آخر إشعار بعد لحظة الجاهزية)
  const [notifiedSinceReady, setNotifiedSinceReady] = useState(true);
  const [feedback, setFeedback] = useState<{ rating: number; comment: string | null } | null>(null);

  const [target, setTarget] = useState<RepairStatus | null>(null);
  const [weightOut, setWeightOut] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [finalCost, setFinalCost] = useState("");
  const [weightAfter, setWeightAfter] = useState("");
  const [note, setNote] = useState("");
  const [deliveredTo, setDeliveredTo] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [busy, setBusy] = useState(false);

  // تعديل بيانات التذكرة — لو الزبون زاد قطعة صغيرة أو طلب لحاماً إضافياً بعد الاستلام.
  const [editing, setEditing] = useState(false);
  const [editItemName, setEditItemName] = useState("");
  const [editItemType, setEditItemType] = useState("");
  const [editKarat, setEditKarat] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editProblem, setEditProblem] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPromisedAt, setEditPromisedAt] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const [t, h, p, s] = await Promise.all([getTicket(id), getStatusHistory(id), getPhotos(id), getSettings()]);
    setTicket(t);
    setHistory(h);
    setPhotos(p);
    setSettings(s);
    const signed = await signedPhotoUrls(p.flatMap((x) => (x.thumb_path ? [x.storage_path, x.thumb_path] : [x.storage_path])));
    setUrls(signed);
    setDeliveredTo(t?.customer?.full_name ?? "");
    if (t?.status === "delivered") {
      const { data: fb } = await supabase.from("repair_feedback").select("rating, comment").eq("ticket_id", t.id).maybeSingle();
      setFeedback(fb ?? null);
    }
    if (t?.status === "ready") {
      const { count } = await supabase
        .from("repair_notifications")
        .select("id", { count: "exact", head: true })
        .eq("ticket_id", t.id)
        .gte("created_at", t.ready_at ?? t.received_at);
      setNotifiedSinceReady((count ?? 0) > 0);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  // السعر على مرحلتين: التقريبي عند الاستلام من الزبون، والحقيقي يُدخله الموظف حين تعود
  // القطعة جاهزة — لا يُملأ تلقائياً بالتقريبي حتى يُكتب فعلاً (مع زر "نفس التقريبي" إن طابقه).
  // عند التسليم يظهر الحقيقي (أو التقريبي لتذكرة جُهّزت قبل هذا التغيير).
  useEffect(() => {
    if (target === "ready") {
      setFinalCost(ticket?.final_cost != null ? String(ticket.final_cost) : "");
    } else if (target === "delivered") {
      const known = ticket?.final_cost ?? ticket?.estimated_cost;
      setFinalCost(known != null ? String(known) : "");
    }
  }, [target, ticket?.final_cost, ticket?.estimated_cost]);

  if (loading) return <AppShell><p className="text-center text-slate-400">جارٍ التحميل…</p></AppShell>;
  if (!ticket) return <AppShell><p className="card p-6 text-center text-slate-500">التذكرة غير موجودة</p></AppShell>;

  const tolerance = settings ? toleranceFrom(settings) : 0.05;
  const isOpen = OPEN_STATUSES.includes(ticket.status);
  const days = daysFromNow(ticket.promised_at);
  const isOverdue = isOpen && days !== null && days < 0;

  // مرجع فحص التسليم: الوزن بعد الصيانة إن سُجّل، وإلا وزن الاستلام.
  const weightRef = ticket.weight_after_repair_grams ?? ticket.weight_in_grams;
  const refLabel = ticket.weight_after_repair_grams !== null ? "وزنها بعد الصيانة" : "وزن الاستلام";
  // تغيّر الوزن بسبب الصيانة (استلام ← جاهزية) — معلومة لا تحذير.
  const repairChange =
    ticket.weight_in_grams !== null && ticket.weight_after_repair_grams !== null
      ? Number((ticket.weight_after_repair_grams - ticket.weight_in_grams).toFixed(3))
      : null;
  const variance =
    weightRef !== null && ticket.weight_out_grams !== null
      ? Number((ticket.weight_out_grams - weightRef).toFixed(3))
      : null;
  const liveRepairChange =
    ticket.weight_in_grams !== null && weightAfter.trim() && Number.isFinite(Number(weightAfter))
      ? Number((Number(weightAfter) - ticket.weight_in_grams).toFixed(3))
      : null;

  // فرق الوزن يُحسب أثناء الكتابة ليراه الموظف قبل الإرسال؛ القرار النهائي في
  // transitionTicket، وهذا عرض مساعد لا تحقّق.
  const liveCheck =
    weightRef !== null && weightOut.trim() && Number.isFinite(Number(weightOut))
      ? checkWeight(weightRef, Number(weightOut), tolerance)
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
      finalCost: (target === "ready" || target === "delivered") && finalCost.trim() ? Number(normalizeDigits(finalCost)) : undefined,
      weightOut: target === "delivered" && weightOut.trim() ? Number(normalizeDigits(weightOut)) : undefined,
      weightAfter: target === "ready" && weightAfter.trim() ? Number(normalizeDigits(weightAfter)) : undefined,
      deliveredToName: deliveredTo.trim() || null,
      varianceNote: varianceNote.trim() || null,
    });

    if (!result.ok) {
      setActionError(result.error);
      setBusy(false);
      return;
    }

    setTarget(null);
    setWeightOut(""); setWeightAfter(""); setWorkDone(""); setFinalCost(""); setNote(""); setVarianceNote("");
    await reload();
    setBusy(false);
    buzz();
    toast(target === "delivered" ? "تم تسليم القطعة" : "تم تحديث الحالة");
  }

  function startEdit() {
    if (!ticket) return;
    setEditItemName(ticket.item_name);
    setEditItemType(ticket.item_type ?? "");
    setEditKarat(ticket.karat ?? "");
    setEditWeight(ticket.weight_in_grams !== null ? String(ticket.weight_in_grams) : "");
    setEditProblem(ticket.problem_description);
    setEditCost(ticket.estimated_cost !== null ? String(ticket.estimated_cost) : "");
    setEditPromisedAt(toLocalInput(ticket.promised_at));
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!ticket || !staff) return;
    if (!editItemName.trim() || !editProblem.trim()) {
      setEditError("اسم القطعة ووصف العمل المطلوب لا يمكن أن يكونا فارغين");
      return;
    }
    setEditBusy(true);
    setEditError(null);

    const result = await updateTicketDetails(ticket.id, staff.staff_id, {
      item_name: editItemName.trim(),
      item_type: editItemType.trim() || null,
      karat: editKarat.trim() || null,
      weight_in_grams: editWeight.trim() ? Number(normalizeDigits(editWeight)) : null,
      problem_description: editProblem.trim(),
      estimated_cost: editCost.trim() ? Number(normalizeDigits(editCost)) : null,
      promised_at: editPromisedAt ? new Date(editPromisedAt).toISOString() : null,
    });

    if (!result.ok) {
      setEditError(result.error);
      setEditBusy(false);
      return;
    }

    setEditing(false);
    setEditBusy(false);
    await reload();
    buzz();
    toast(result.changed ? "تم حفظ التعديل" : "لا يوجد تغيير");
  }

  async function notifyWhatsApp() {
    if (!ticket || !staff) return;
    const ok = await notifyCustomer(ticket, defaultKind(ticket.status), settings?.shop_name ?? "", staff.staff_id);
    if (!ok) return toast("رقم الزبون غير صالح", "error");
    toast("تم فتح واتساب للزبون");
    await reload();
  }

  async function addPhotos(fileList: FileList | null, stage: "progress" | "delivery") {
    if (!fileList || !ticket || !staff) return;
    let uploaded = 0;
    const files = await compressImages(Array.from(fileList));
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${ticket.id}/${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
        contentType: file.type || "image/jpeg",
        cacheControl: "31536000",
      });
      if (error) continue;

      const thumb = await makeThumbnail(file);
      let thumbPath: string | null = null;
      if (thumb) {
        const tPath = `${ticket.id}/${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-thumb.jpg`;
        const { error: thumbErr } = await supabase.storage.from(PHOTO_BUCKET).upload(tPath, thumb, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (!thumbErr) thumbPath = tPath;
      }

      await supabase.from("repair_photos").insert({
        ticket_id: ticket.id,
        storage_path: path,
        thumb_path: thumbPath,
        stage,
        uploaded_by: staff.staff_id,
        is_public: stage !== "progress",
      });
      uploaded++;
    }
    await reload();
    if (uploaded > 0) toast(uploaded === 1 ? "تم رفع الصورة" : `تم رفع ${uploaded} صور`);
    else if (fileList.length > 0) toast("تعذّر رفع الصور", "error");
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

      {ticket.customer && (
        <Link
          to={`/tickets/new?${new URLSearchParams({
            customerId: ticket.customer.id,
            customerName: ticket.customer.full_name,
            phone: ticket.customer.phone ?? "",
            branchId: ticket.branch_id,
          }).toString()}`}
          className="btn-ghost mb-4 w-full border-dashed"
        >
          + قطعة أخرى لنفس الزبون
        </Link>
      )}

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
                      {ticket.weight_in_grams !== null && (
                        <div className="mb-3">
                          <label className="label" htmlFor="weight_after">الوزن بعد الصيانة (غرام) <span className="text-red-600">*</span></label>
                          <input id="weight_after" type="text" inputMode="decimal" dir="ltr" className="field text-left"
                            placeholder="0.000" value={weightAfter} onChange={(e) => setWeightAfter(normalizeDigits(e.target.value))} />
                          <p className="mt-1 text-xs text-slate-500">
                            وزن الاستلام {ticket.weight_in_grams.toFixed(3)} غ
                            {liveRepairChange !== null && (
                              <> — التغيّر بسبب الصيانة: <span className="font-semibold text-brand-800" dir="ltr">{liveRepairChange > 0 ? "+" : ""}{liveRepairChange.toFixed(3)} غ</span></>
                            )}
                          </p>
                        </div>
                      )}
                      <label className="label" htmlFor="final_cost">السعر الحقيقي <span className="text-red-600">*</span></label>
                      <input id="final_cost" type="text" inputMode="decimal" dir="ltr" className="field text-left text-lg font-bold"
                        placeholder="0" value={finalCost} onChange={(e) => setFinalCost(normalizeDigits(e.target.value))} />
                      {ticket.estimated_cost !== null && (
                        <button
                          type="button"
                          className="mt-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                          onClick={() => setFinalCost(String(ticket.estimated_cost))}
                        >
                          نفس التقريبي — {formatMoney(ticket.estimated_cost)}
                        </button>
                      )}
                      {!finalCost.trim() && (
                        <p className="mt-1 text-xs text-red-700">مطلوب — اكتب السعر الحقيقي للصيانة.</p>
                      )}
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
                        <p className="mt-1 text-xs text-slate-500">{refLabel} {weightRef?.toFixed(3)} غ</p>

                        {/* الفرق معلومة للموظف فقط — لا يمنع التسليم، وهو من يقرر إن احتاج ملاحظة. */}
                        {liveCheck && liveCheck.difference !== 0 && (
                          <div className="mt-2 rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-800">
                            الفرق: {liveCheck.difference > 0 ? "+" : ""}{liveCheck.difference.toFixed(3)} غ
                          </div>
                        )}

                        {liveCheck && liveCheck.difference !== 0 && (
                          <input className="field mt-2" placeholder="سبب الفرق (اختياري — مثال: استبدال فص، إزالة لحام)"
                            value={varianceNote} onChange={(e) => setVarianceNote(e.target.value)} />
                        )}
                      </div>
                    )}

                    <div>
                      <label className="label" htmlFor="delivery_price">السعر الحقيقي <span className="text-red-600">*</span></label>
                      <input id="delivery_price" type="text" inputMode="decimal" dir="ltr" className="field text-left"
                        placeholder="0" value={finalCost} onChange={(e) => setFinalCost(normalizeDigits(e.target.value))} />
                      {!finalCost.trim() && (
                        <p className="mt-1 text-xs text-red-700">مطلوب — لا يمكن تسليم القطعة بلا سعر.</p>
                      )}
                    </div>

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

                <button type="button" onClick={onTransition} className="btn-success w-full py-3"
                  disabled={busy
                    || ((target === "delivered" || target === "ready") && !finalCost.trim())
                    || (target === "ready" && ticket.weight_in_grams !== null && !weightAfter.trim())}>
                  {busy && <span className="spinner" />}
                  {busy ? "جارٍ الحفظ…" : target === "delivered" ? "تأكيد التسليم" : `تغيير إلى ${REPAIR_STATUS[target].label}`}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {ticket.status === "ready" && ticket.customer?.phone && !notifiedSinceReady && (
        <section className="card mb-4 border-gold-500 bg-gold-50 p-4">
          <p className="mb-2 font-bold text-slate-900">القطعة جاهزة — لم يُبلَّغ الزبون بعد</p>
          <button type="button" onClick={notifyWhatsApp} className="btn-success w-full">أبلغ الزبون الآن عبر واتساب</button>
        </section>
      )}

      {ticket.status === "delivered" && (
        <section className="card mb-4 p-4">
          <h2 className="mb-1 font-bold text-slate-900">تقييم الزبون</h2>
          {feedback ? (
            <>
              <p className="text-xl text-gold-600" aria-label={`${feedback.rating} من 5`}>
                {"★".repeat(feedback.rating)}<span className="text-slate-300">{"★".repeat(5 - feedback.rating)}</span>
              </p>
              {feedback.comment && <p className="mt-1 text-sm text-slate-600">{feedback.comment}</p>}
            </>
          ) : (
            <p className="text-sm text-slate-400">لم يقيّم الزبون بعد — يصله رابط التقييم في رسالة التسليم.</p>
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
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">القطعة</h2>
          {isOpen && !editing && (
            <button type="button" onClick={startEdit} className="text-sm font-medium text-brand-700 hover:underline">
              تعديل
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="edit_item_name">اسم القطعة</label>
              <input id="edit_item_name" className="field" value={editItemName} onChange={(e) => setEditItemName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="edit_item_type">النوع</label>
                <select id="edit_item_type" className="field" value={editItemType} onChange={(e) => setEditItemType(e.target.value)}>
                  <option value="">—</option>
                  {ITEM_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="edit_karat">العيار</label>
                <select id="edit_karat" className="field" value={editKarat} onChange={(e) => setEditKarat(e.target.value)}>
                  <option value="">—</option>
                  {KARAT_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="edit_weight">الوزن عند الاستلام (غرام)</label>
              <input id="edit_weight" type="text" inputMode="decimal" dir="ltr" className="field text-left"
                placeholder="0.000" value={editWeight} onChange={(e) => setEditWeight(normalizeDigits(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="edit_problem">العمل المطلوب</label>
              <textarea id="edit_problem" rows={3} className="field" value={editProblem} onChange={(e) => setEditProblem(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="edit_cost">السعر التقريبي</label>
              <input id="edit_cost" type="text" inputMode="decimal" dir="ltr" className="field text-left"
                value={editCost} onChange={(e) => setEditCost(normalizeDigits(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="edit_promised_at">موعد التسليم</label>
              <input id="edit_promised_at" type="datetime-local" className="field" value={editPromisedAt}
                onChange={(e) => setEditPromisedAt(e.target.value)} />
            </div>

            {editError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={saveEdit} disabled={editBusy} className="btn-success flex-1 py-3">
                {editBusy && <span className="spinner" />}
                {editBusy ? "جارٍ الحفظ…" : "حفظ التعديل"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="btn-ghost flex-1 py-3">إلغاء</button>
            </div>
          </div>
        ) : (
          <>
            <dl className="space-y-1.5 text-sm">
              {ticket.item_code && <Row label="الكود" value={ticket.item_code} />}
              {ticket.item_type && <Row label="النوع" value={ticket.item_type} />}
              {ticket.karat && <Row label="العيار" value={ticket.karat} />}
              <Row label="الوزن عند الاستلام" value={formatWeight(ticket.weight_in_grams)} />
              {ticket.weight_after_repair_grams !== null && (
                <Row
                  label="الوزن بعد الصيانة"
                  value={`${formatWeight(ticket.weight_after_repair_grams)}${repairChange ? ` (${repairChange > 0 ? "+" : ""}${repairChange.toFixed(3)} غ بسبب الصيانة)` : ""}`}
                />
              )}
              {ticket.weight_out_grams !== null && <Row label="الوزن عند التسليم" value={formatWeight(ticket.weight_out_grams)} />}
              <Row label="المصدر" value={ticket.item_source === "inventory" ? "من المخزون" : "إدخال يدوي"} />
            </dl>

            {variance !== null && variance !== 0 && (
              <div className="mt-3 rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-800">
                فرق التسليم عن {refLabel}: {variance > 0 ? "+" : ""}{variance.toFixed(3)} غ
                {ticket.weight_variance_note && (
                  <span className="mt-1 block text-xs opacity-80">{ticket.weight_variance_note}</span>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {!editing && (
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
            <Row label="السعر التقريبي" value={formatMoney(ticket.estimated_cost)} />
            {ticket.final_cost !== null && <Row label="السعر الحقيقي" value={formatMoney(ticket.final_cost)} />}
            <Row label="الاستلام" value={formatDateTime(ticket.received_at)} />
            <Row label="موعد التسليم" value={formatDateTime(ticket.promised_at)} />
            {ticket.delivered_at && <Row label="سُلّمت" value={formatDateTime(ticket.delivered_at)} />}
            {ticket.received_by_staff && <Row label="استلمها" value={ticket.received_by_staff.full_name} />}
          </dl>
        </section>
      )}


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
<div
                  className="aspect-square w-full bg-slate-100 bg-cover bg-center"
                  style={photo.thumb_path && urls[photo.thumb_path] ? { backgroundImage: `url(${urls[photo.thumb_path]})` } : undefined}
                >
                  <img
                    src={urls[photo.storage_path]}
                    alt={PHOTO_STAGE[photo.stage]}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </div>
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
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${entry.from_status === entry.to_status ? "bg-slate-300" : REPAIR_STATUS[entry.to_status].dot}`} />
              <div>
                <p className="font-medium text-slate-900">
                  {entry.from_status === entry.to_status ? "✏️ تعديل بيانات" : REPAIR_STATUS[entry.to_status].label}
                </p>
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

/** لحقل datetime-local يحتاج توقيتاً محلياً بلا منطقة زمنية. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-left font-medium text-slate-900">{value}</dd>
    </div>
  );
}
