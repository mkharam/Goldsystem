import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Steps } from "@/components/Steps";
import { useAuth } from "@/lib/auth";
import { buzz } from "@/lib/haptics";
import { supabase, PHOTO_BUCKET } from "@/lib/supabase";
import { inventoryHealth } from "@/lib/inventory";
import {
  searchCustomers, resolveCustomer, createTicket, getSettings,
  type CustomerMatch,
} from "@/lib/tickets";
import { KARAT_OPTIONS, ITEM_TYPE_OPTIONS, normalizeDigits } from "@/lib/constants";

type Branch = { id: string; name: string; code: string | null };

const STEP_LABELS = ["الزبون", "القطعة", "العطل"];

function defaultPromisedAt(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  // قيمة datetime-local محلية لا UTC، وإلا ظهر موعد مزاح بفارق المنطقة.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T18:00`;
}

/**
 * استلام قطعة، خطوة بخطوة.
 *
 * كانت استمارة واحدة طويلة، وهي تُربك من ليس تقنياً: لا يعرف أين يبدأ ولا متى
 * انتهى. الآن ثلاث خطوات، في كل واحدة سؤال واحد واضح وزر واحد كبير، ولا ينتقل
 * إلا بعد اكتمال ما تحتاجه — فالخطأ يظهر مكانه لا بعد الحفظ.
 */
export default function NewTicket() {
  const { staff } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [inventoryDown, setInventoryDown] = useState(false);
  const [promisedAt, setPromisedAt] = useState("");

  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);

  const [itemName, setItemName] = useState("");
  const [itemType, setItemType] = useState("");
  const [karat, setKarat] = useState("");
  const [weight, setWeight] = useState("");
  const [problem, setProblem] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: rows }, settings, health] = await Promise.all([
        supabase.from("branches").select("id, name, code").eq("is_active", true).order("code"),
        getSettings(),
        inventoryHealth(),
      ]);
      setBranches(rows ?? []);
      setBranchId(staff?.branch_id ?? rows?.[0]?.id ?? "");
      setPromisedAt(defaultPromisedAt(Number(settings.default_turnaround_days) || 3));
      setInventoryDown(health === "down");
    })();
  }, [staff]);

  // بحث الزبون أثناء الكتابة، بمهلة قصيرة حتى لا نستدعي الخادم على كل حرف.
  useEffect(() => {
    const digits = normalizeDigits(phone).replace(/\D/g, "");
    if (digits.length < 3 || customerId) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      searchCustomers(digits).then(setMatches).catch(() => setMatches([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [phone, customerId]);

  async function uploadPhotos(ticketId: string) {
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${ticketId}/intake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
        contentType: file.type || "image/jpeg",
      });
      // صورة فاشلة لا تُسقط التذكرة — تُرفع لاحقاً من صفحة التفاصيل.
      if (upErr) continue;

      await supabase.from("repair_photos").insert({
        ticket_id: ticketId,
        storage_path: path,
        stage: "intake",
        uploaded_by: staff!.staff_id,
        is_public: true,
      });
    }
  }

  /** لا ينتقل لخطوة تالية قبل اكتمال الحالية — الخطأ يظهر مكانه لا بعد الحفظ. */
  function goNext() {
    setError(null);
    if (step === 0) {
      if (!normalizeDigits(phone).trim()) return setError("اكتب رقم هاتف الزبون");
      if (!customerName.trim()) return setError("اكتب اسم الزبون");
    }
    if (step === 1 && !itemName.trim()) return setError("اكتب اسم القطعة أو وصفها");
    setStep((s) => s + 1);
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function onSave() {
    setError(null);
    if (!problem.trim()) return setError("اكتب وصف العطل أو العمل المطلوب");
    if (!branchId) return setError("اختر الفرع");

    setBusy(true);
    try {
      const resolvedCustomerId = await resolveCustomer({
        customerId: customerId || null,
        fullName: customerName.trim(),
        phone: normalizeDigits(phone).trim(),
      });

      const ticket = await createTicket({
        customer_id: resolvedCustomerId,
        branch_id: branchId,
        received_by: staff!.staff_id,
        item_source: "manual",
        inventory_product_id: null,
        item_code: null,
        item_name: itemName.trim(),
        item_type: itemType || null,
        karat: karat || null,
        weight_in_grams: weight.trim() ? Number(normalizeDigits(weight)) : null,
        problem_description: problem.trim(),
        estimated_cost: estimatedCost.trim() ? Number(normalizeDigits(estimatedCost)) : null,
        promised_at: promisedAt ? new Date(promisedAt).toISOString() : null,
      });

      await uploadPhotos(ticket.id);
      buzz([15, 60, 15]); // نبضتان: تُحسّ بوضوح كتأكيد "تم" دون أن تكون طويلة مزعجة.
      // الإيصال فوراً بعد الاستلام — الزبون واقف ينتظره.
      navigate(`/tickets/${ticket.id}/receipt`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر حفظ التذكرة");
      setBusy(false);
    }
  }

  const branchName = branches.find((b) => b.id === branchId)?.name;
  const promisedLabel = promisedAt
    ? new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        .format(new Date(promisedAt))
    : "—";

  return (
    <AppShell inventoryDown={inventoryDown}>
      <h1 className="mb-4 text-center text-lg font-bold text-slate-900">استلام قطعة</h1>

      <Steps labels={STEP_LABELS} current={step} />

      <div className="card p-4">
        {/* ——— ١ الزبون ——— */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="relative">
              <label className="label text-base" htmlFor="phone">رقم هاتف الزبون</label>
              <input
                id="phone"
                type="text"
                inputMode="tel"
                dir="ltr"
                autoFocus
                className="field py-3.5 text-left text-lg"
                placeholder="09xxxxxxxx"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (customerId) setCustomerId("");
                }}
              />

              {matches.length > 0 && !customerId && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerId(m.id);
                          setCustomerName(m.full_name);
                          setPhone(m.phone);
                          setMatches([]);
                        }}
                        className="flex w-full items-center justify-between px-3 py-3 text-right hover:bg-brand-50"
                      >
                        <span>
                          <span className="block font-medium text-slate-900">{m.full_name}</span>
                          <span className="block text-xs text-slate-500" dir="ltr">{m.phone}</span>
                        </span>
                        <span className="badge border-brand-200 bg-brand-50 text-brand-700">زبون سابق</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-xs text-slate-500">لو الزبون سبق أن جاء، سيظهر اسمه — اضغط عليه.</p>
            </div>

            <div>
              <label className="label text-base" htmlFor="customer_name">اسم الزبون</label>
              <input
                id="customer_name"
                className="field py-3.5 text-lg"
                placeholder="الاسم كما يُنطق"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ——— ٢ القطعة ——— */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="label text-base" htmlFor="item_name">ما هي القطعة؟</label>
              <input
                id="item_name"
                autoFocus
                className="field py-3.5 text-lg"
                placeholder="مثال: خاتم ذهب بفص"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
            </div>

            <div>
              <label className="label text-base">العيار</label>
              {/* أزرار بدل قائمة منسدلة: الخيارات قليلة واللمس أسرع من فتح قائمة. */}
              <div className="grid grid-cols-4 gap-2">
                {KARAT_OPTIONS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setKarat(karat === o ? "" : o)}
                    className={`rounded-lg border py-3 text-sm font-semibold transition ${
                      karat === o
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label text-base" htmlFor="weight">الوزن بالغرام</label>
              <input
                id="weight"
                type="text"
                inputMode="decimal"
                dir="ltr"
                className="field py-3.5 text-left text-lg"
                placeholder="0.000"
                value={weight}
                onChange={(e) => setWeight(normalizeDigits(e.target.value))}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                مهم: يُقارَن بالوزن عند التسليم للتأكد أن الذهب لم ينقص.
              </p>
            </div>

            <div>
              <label className="label text-base">صور القطعة</label>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className={`w-full rounded-lg border-2 border-dashed py-5 text-sm font-medium transition ${
                  files.length > 0
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-slate-300 text-slate-500"
                }`}
              >
                {files.length > 0 ? `✓ ${files.length} صورة — اضغط للتغيير` : "📷 صوّر القطعة الآن"}
              </button>
              <p className="mt-1.5 text-xs text-slate-500">دليل حالتها قبل العمل عليها — يحميك من أي خلاف.</p>
            </div>
          </div>
        )}

        {/* ——— ٣ العطل ——— */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="label text-base" htmlFor="problem">ما المطلوب عملـه؟</label>
              <textarea
                id="problem"
                rows={3}
                autoFocus
                className="field text-lg"
                placeholder="مثال: كسر في المشبك، تلميع، تصغير مقاس"
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
              />
            </div>

            {/* مراجعة سريعة قبل الحفظ: يرى ما سيُطبع على الإيصال. */}
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-2 font-semibold text-slate-700">مراجعة</p>
              <dl className="space-y-1 text-slate-600">
                <Line label="الزبون" value={`${customerName || "—"} · ${phone || "—"}`} />
                <Line label="القطعة" value={[itemName || "—", karat, weight ? `${weight} غ` : ""].filter(Boolean).join(" · ")} />
                <Line label="الفرع" value={branchName ?? "—"} />
                <Line label="التسليم" value={promisedLabel} />
                {estimatedCost && <Line label="التكلفة" value={estimatedCost} />}
              </dl>
            </div>

            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-sm text-slate-500"
            >
              {showMore ? "إخفاء" : "تعديل الفرع أو الموعد أو التكلفة"}
            </button>

            {showMore && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                <div>
                  <label className="label" htmlFor="item_type">نوع القطعة</label>
                  <select id="item_type" className="field" value={itemType} onChange={(e) => setItemType(e.target.value)}>
                    <option value="">—</option>
                    {ITEM_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="cost">التكلفة التقديرية</label>
                  <input
                    id="cost"
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    className="field text-left"
                    placeholder="0"
                    value={estimatedCost}
                    onChange={(e) => setEstimatedCost(normalizeDigits(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="promised">موعد التسليم</label>
                  <input
                    id="promised"
                    type="datetime-local"
                    className="field"
                    value={promisedAt}
                    onChange={(e) => setPromisedAt(e.target.value)}
                  />
                </div>
                {branches.length > 1 && (
                  <div>
                    <label className="label" htmlFor="branch">الفرع</label>
                    <select id="branch" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-3 text-center text-sm font-medium text-red-700">
            {error}
          </p>
        )}
      </div>

      {/* ——— التنقّل ——— */}
      <div className="mt-4 flex gap-2">
        {step > 0 && (
          <button type="button" onClick={goBack} className="btn-ghost w-28 py-4" disabled={busy}>
            رجوع
          </button>
        )}
        {step < 2 ? (
          <button type="button" onClick={goNext} className="btn-primary flex-1 py-4 text-base">
            التالي
          </button>
        ) : (
          <button type="button" onClick={onSave} className="btn-success flex-1 py-4 text-base" disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? "جارٍ الحفظ…" : "حفظ وطباعة الإيصال"}
          </button>
        )}
      </div>
    </AppShell>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-left font-medium text-slate-700">{value}</dd>
    </div>
  );
}
