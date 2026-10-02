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
import { loadDraft, saveDraft, clearDraft, saveItemFiles, loadItemFiles } from "@/lib/draft";

type Branch = { id: string; name: string; code: string | null };

const STEP_LABELS = ["الزبون", "القطع", "التسليم"];

/** قطعة واحدة من قطع الزبون — كل قطعة تصبح تذكرة مستقلة بحالتها وإيصالها ورمز متابعتها. */
type Item = {
  key: string;
  name: string;
  type: string;
  karat: string;
  weight: string;
  problem: string;
  cost: string;
  files: File[];
};

const newItem = (): Item => ({
  key: Math.random().toString(36).slice(2),
  name: "", type: "", karat: "", weight: "", problem: "", cost: "", files: [],
});

const MAX_ITEMS = 20;

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
  // مدة الإنجاز المعتادة من الإعدادات — تُعرض كاختيار سريع فقط، لا تُملأ تلقائياً.
  const [turnaroundDays, setTurnaroundDays] = useState(3);

  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);

  // زبون بأكثر من قطعة: كل قطعة ببياناتها. تبدأ بقطعة واحدة، ويزيد الموظف العدد بزر.
  const [items, setItems] = useState<Item[]>([newItem()]);
  const updateItem = (key: string, patch: Partial<Item>) => {
    // الصور تُحفظ فوراً في المسودّة — هي أصعب ما يُعاد إن أُغلق التطبيق.
    if (patch.files) void saveItemFiles(key, patch.files);
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };
  const removeItem = (key: string) => {
    void saveItemFiles(key, []);
    setItems((list) => list.filter((x) => x.key !== key));
  };
  const setCount = (n: number) =>
    setItems((list) => {
      const count = Math.min(MAX_ITEMS, Math.max(1, n));
      if (count <= list.length) return list.slice(0, count);
      return [...list, ...Array.from({ length: count - list.length }, newItem)];
    });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // تذاكر حُفظت قبل أن ينقطع الحفظ (إنترنت ضعيف/إغلاق التطبيق) — تُضمّ لإيصال الباقي.
  const [savedIds, setSavedIds] = useState<string[]>([]);
  // المسودّة: تُستعاد مرة عند الفتح، ثم تُحفظ مع كل تعديل. الآيفون يغلق التطبيق في الخلفية
  // حين يفتح الموظف واتساب أو الكاميرا، فلا يضيع ما كتبه ولا صوره.
  const [draftReady, setDraftReady] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const d = loadDraft();
    if (!d) {
      setDraftReady(true);
      return;
    }
    setStep(d.step);
    setPhone(d.phone);
    setCustomerName(d.customerName);
    setCustomerId(d.customerId);
    if (d.branchId) setBranchId(d.branchId);
    setPromisedAt(d.promisedAt);
    setSavedIds(d.savedIds ?? []);
    setItems(d.items.length ? d.items.map((it) => ({ ...it, files: [] })) : [newItem()]);
    setRestored(true);
    setDraftReady(true);
    // الصور من IndexedDB بعد النصوص — لا ننتظرها لعرض النموذج.
    void Promise.all(d.items.map(async (it) => [it.key, await loadItemFiles(it.key)] as const)).then((pairs) => {
      const byKey = new Map(pairs);
      setItems((list) => list.map((it) => (byKey.get(it.key)?.length ? { ...it, files: byKey.get(it.key)! } : it)));
    });
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const empty = !phone.trim() && !customerName.trim() && savedIds.length === 0 &&
      items.every((it) => !it.name.trim() && !it.problem.trim() && !it.weight.trim() && it.files.length === 0);
    const t = setTimeout(() => {
      if (empty) return void clearDraft();
      saveDraft({
        step, phone, customerName, customerId, branchId, promisedAt, savedIds,
        items: items.map(({ files: _f, ...rest }) => rest),
      });
    }, 300);
    return () => clearTimeout(t);
  }, [draftReady, step, phone, customerName, customerId, branchId, promisedAt, items, savedIds]);

  async function startOver() {
    await clearDraft();
    setStep(0);
    setPhone("");
    setCustomerName("");
    setCustomerId("");
    setPromisedAt("");
    setSavedIds([]);
    setItems([newItem()]);
    setRestored(false);
    setError(null);
  }

  useEffect(() => {
    (async () => {
      const [{ data: rows }, settings, health] = await Promise.all([
        supabase.from("branches").select("id, name, code").eq("is_active", true).order("code"),
        getSettings(),
        inventoryHealth(),
      ]);
      // غير المدير العام لا يفتح تذكرة إلا في فرعه (وRLS ترفض غير ذلك).
      const allowed = staff?.role === "admin" ? (rows ?? []) : (rows ?? []).filter((b) => b.id === staff?.branch_id);
      setBranches(allowed);
      // لا نكتب فوق فرع استُعيد من المسودّة.
      setBranchId((current) => current || staff?.branch_id || allowed[0]?.id || "");
      // موعد التسليم لا يُملأ تلقائياً: كان يُكتب "بعد 3 أيام" في كل إيصال حتى حين لم يتفق
      // الموظف مع الزبون على موعد، فيعود الزبون في يوم لم يَعِده به أحد. الموظف يختاره
      // بنفسه، وإن تركه فارغاً لا يُطبع في الإيصال أصلاً.
      setTurnaroundDays(Number(settings.default_turnaround_days) || 3);
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

  async function uploadPhotos(ticketId: string, files: File[]) {
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
    if (step === 1) {
      // الخطأ يشير للقطعة بالرقم — مع عدة قطع يجب أن يعرف الموظف أيّها ناقصة.
      const label = (i: number) => (items.length > 1 ? ` (القطعة ${i + 1})` : "");
      for (let i = 0; i < items.length; i++) {
        if (!items[i].name.trim()) return setError(`اكتب اسم القطعة أو وصفها${label(i)}`);
        if (!items[i].problem.trim()) return setError(`اكتب المطلوب عمله${label(i)}`);
      }
    }
    setStep((s) => s + 1);
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function onSave() {
    setError(null);
    if (!branchId) return setError("اختر الفرع");

    setBusy(true);
    try {
      const resolvedCustomerId = await resolveCustomer({
        customerId: customerId || null,
        fullName: customerName.trim(),
        phone: normalizeDigits(phone).trim(),
      });

      // تذكرة لكل قطعة، بالتتابع حتى تأخذ أرقاماً متتالية. ما حُفظ يبقى محفوظاً إن فشلت
      // قطعة لاحقة — لا نعيد إنشاءه عند إعادة المحاولة.
      const ids: string[] = [...savedIds];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (items.length > 1) setProgress(`حفظ القطعة ${i + 1} من ${items.length}…`);
        const ticket = await createTicket({
          customer_id: resolvedCustomerId,
          branch_id: branchId,
          received_by: staff!.staff_id,
          item_source: "manual",
          inventory_product_id: null,
          item_code: null,
          item_name: it.name.trim(),
          item_type: it.type || null,
          karat: it.karat || null,
          weight_in_grams: it.weight.trim() ? Number(normalizeDigits(it.weight)) : null,
          problem_description: it.problem.trim(),
          // فارغ = السعر لاحقاً — يُطلب إلزامياً عند التسليم (require_price_on_delivery).
          estimated_cost: it.cost.trim() ? Number(normalizeDigits(it.cost)) : null,
          promised_at: promisedAt ? new Date(promisedAt).toISOString() : null,
        });
        await uploadPhotos(ticket.id, it.files);
        ids.push(ticket.id);
        setSavedIds([...ids]);
        removeItem(it.key);
      }
      await clearDraft();
      buzz([15, 60, 15]); // نبضتان: تُحسّ بوضوح كتأكيد "تم" دون أن تكون طويلة مزعجة.
      // الإيصال فوراً بعد الاستلام — الزبون واقف ينتظره. عدة قطع = إيصال واحد مجمّع.
      navigate(ids.length === 1 ? `/tickets/${ids[0]}/receipt` : `/receipts?ids=${ids.join(",")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر حفظ التذكرة");
      setProgress("");
      setBusy(false);
    }
  }

  const branchName = branches.find((b) => b.id === branchId)?.name;
  const promisedLabel = promisedAt
    ? new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        .format(new Date(promisedAt))
    : "بدون موعد";

  return (
    <AppShell inventoryDown={inventoryDown}>
      <h1 className="mb-4 text-center text-lg font-bold text-slate-900">{items.length > 1 ? `استلام ${items.length} قطع` : "استلام قطعة"}</h1>

      {restored && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-50 px-3 py-2.5 text-sm">
          <span className="text-slate-700">
            ↩︎ أكملنا من حيث توقفت{savedIds.length > 0 && ` — ${savedIds.length} قطعة حُفظت من قبل`}
          </span>
          <button type="button" onClick={startOver} className="shrink-0 font-semibold text-gold-700 underline-offset-4 hover:underline">
            استلام جديد
          </button>
        </div>
      )}

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

        {/* ——— ٢ القطع ——— */}
        {/* كم قطعة؟ ثم بطاقة لكل قطعة: اسمها، عيارها، وزنها، المطلوب، سعرها، وصورتها. */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2.5">
              <span className="text-base font-bold text-brand-800">كم قطعة؟</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="أقل" disabled={items.length <= 1}
                  onClick={() => setCount(items.length - 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-brand-300 bg-white text-xl font-bold text-brand-700 disabled:opacity-40">
                  −
                </button>
                <span className="w-8 text-center text-2xl font-extrabold tabular-nums text-brand-900">{items.length}</span>
                <button type="button" aria-label="أكثر" disabled={items.length >= MAX_ITEMS}
                  onClick={() => setCount(items.length + 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-700 text-xl font-bold text-white disabled:opacity-40">
                  +
                </button>
              </div>
            </div>

            {items.map((it, i) => (
              <ItemCard
                key={it.key}
                index={i}
                total={items.length}
                item={it}
                onChange={(patch) => updateItem(it.key, patch)}
                onRemove={items.length > 1 ? () => removeItem(it.key) : undefined}
              />
            ))}

            {items.length < MAX_ITEMS && (
              <button type="button" onClick={() => setCount(items.length + 1)}
                className="w-full rounded-lg border-2 border-dashed border-brand-300 py-3 text-sm font-semibold text-brand-700">
                + إضافة قطعة أخرى لنفس الزبون
              </button>
            )}
          </div>
        )}

        {/* ——— ٣ التسليم ——— */}
        {/* الموعد خيار خفيف بضغطة، ثم مراجعة كل القطع قبل الحفظ. الفرع — نادراً ما يتغيّر — في "المزيد". */}
        {step === 2 && (
          <div className="space-y-5">
            {/* موعد التسليم — اختياري وخفيف */}
            <div>
              <p className="label">
                موعد التسليم <span className="font-normal text-slate-400">(اختياري)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { days: 0, label: "بدون موعد" },
                  { days: 1, label: "غداً" },
                  ...(turnaroundDays !== 1 && turnaroundDays !== 7 ? [{ days: turnaroundDays, label: `بعد ${turnaroundDays} أيام` }] : []),
                  { days: 7, label: "بعد أسبوع" },
                ].map((o) => {
                  const value = o.days === 0 ? "" : defaultPromisedAt(o.days);
                  const active = !showDatePicker && promisedAt === value;
                  return (
                    <button
                      key={o.days}
                      type="button"
                      onClick={() => { setShowDatePicker(false); setPromisedAt(value); }}
                      className={`h-9 rounded-full border px-3.5 text-sm font-medium transition ${
                        active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowDatePicker(true)}
                  className={`h-9 rounded-full border px-3.5 text-sm font-medium transition ${
                    showDatePicker ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  تاريخ آخر…
                </button>
              </div>
              {showDatePicker && (
                <input
                  id="promised"
                  type="datetime-local"
                  className="field mt-2"
                  value={promisedAt}
                  onChange={(e) => setPromisedAt(e.target.value)}
                />
              )}
            </div>

            {/* مراجعة سريعة قبل الحفظ: يرى ما سيُطبع على الإيصالات. */}
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="mb-2 font-semibold text-slate-700">
                مراجعة{items.length > 1 && <span className="font-normal text-slate-500"> — {items.length} قطع في إيصال واحد</span>}
              </p>
              <dl className="space-y-1 text-slate-600">
                <Line label="الزبون" value={`${customerName || "—"} · ${phone || "—"}`} />
                <Line label="التسليم" value={promisedLabel} />
                <Line label="الفرع" value={branchName ?? "—"} />
              </dl>
              <ol className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
                {items.map((it, i) => (
                  <li key={it.key} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-slate-700">
                      {items.length > 1 && <span className="text-slate-400">{i + 1}. </span>}
                      {[it.name || "—", it.karat, it.weight ? `${it.weight} غ` : ""].filter(Boolean).join(" · ")}
                    </span>
                    <span className="shrink-0 text-slate-500">{it.cost ? `${it.cost} د.ل` : "السعر لاحقاً"}</span>
                  </li>
                ))}
              </ol>
            </div>

            {branches.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowMore((v) => !v)}
                  className="w-full py-1 text-sm text-slate-500 underline-offset-4 hover:underline"
                >
                  {showMore ? "إخفاء" : "تغيير الفرع"}
                </button>
                {showMore && (
                  <div className="border-t border-slate-100 pt-3">
                    <label className="label" htmlFor="branch">الفرع</label>
                    <select id="branch" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
              </>
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
            {busy ? progress || "جارٍ الحفظ…" : items.length > 1 ? `حفظ وطباعة الإيصال (${items.length} قطع)` : "حفظ وطباعة الإيصال"}
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

/** بطاقة قطعة واحدة: كل ما يُطبع على إيصالها. */
function ItemCard({
  index, total, item, onChange, onRemove,
}: {
  index: number;
  total: number;
  item: Item;
  onChange: (patch: Partial<Item>) => void;
  onRemove?: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [showType, setShowType] = useState(false);
  const id = (f: string) => `${f}-${item.key}`;

  return (
    <div className={total > 1 ? "rounded-xl border border-gold-300/70 bg-white p-3 shadow-sm" : ""}>
      {total > 1 && (
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-base font-bold text-brand-800">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-600 text-sm text-white">{index + 1}</span>
            القطعة {index + 1}
          </span>
          {onRemove && (
            <button type="button" onClick={onRemove} className="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50">
              حذف
            </button>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="label text-base" htmlFor={id("name")}>ما هي القطعة؟</label>
          <input
            id={id("name")}
            autoFocus={index === 0}
            className="field py-3.5 text-lg"
            placeholder="مثال: خاتم ذهب بفص"
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
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
                onClick={() => onChange({ karat: item.karat === o ? "" : o })}
                className={`rounded-lg border py-3 text-sm font-semibold transition ${
                  item.karat === o ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label text-base" htmlFor={id("weight")}>الوزن بالغرام</label>
          <input
            id={id("weight")}
            type="text"
            inputMode="decimal"
            dir="ltr"
            className="field py-3.5 text-left text-lg"
            placeholder="0.000"
            value={item.weight}
            onChange={(e) => onChange({ weight: normalizeDigits(e.target.value) })}
          />
          {index === 0 && (
            <p className="mt-1.5 text-xs text-slate-500">مهم: يُقارَن بالوزن عند التسليم للتأكد أن الذهب لم ينقص.</p>
          )}
        </div>

        <div>
          <label className="label text-base" htmlFor={id("problem")}>ما المطلوب عمله؟</label>
          <textarea
            id={id("problem")}
            rows={2}
            className="field text-lg"
            placeholder="مثال: كسر في المشبك، تلميع، تصغير مقاس"
            value={item.problem}
            onChange={(e) => onChange({ problem: e.target.value })}
          />
        </div>

        {/* السعر بارز — يراه الزبون ويتفق عليه قبل أن يترك قطعته. فارغ = يُحدَّد بعد الفحص. */}
        <div className="flex items-center gap-3 rounded-xl border border-gold-300/70 bg-gradient-to-b from-gold-50 to-white px-3 py-2">
          <label htmlFor={id("cost")} className="shrink-0 text-sm font-bold text-brand-800">السعر التقريبي</label>
          <input
            id={id("cost")}
            type="text"
            inputMode="decimal"
            dir="ltr"
            className="min-w-0 flex-1 border-0 border-b-2 border-gold-400 bg-transparent py-1 text-center text-2xl font-extrabold text-brand-900 outline-none placeholder:text-sm placeholder:font-normal placeholder:text-slate-400 focus:border-brand-600"
            placeholder="فارغ = لاحقاً"
            value={item.cost}
            onChange={(e) => onChange({ cost: normalizeDigits(e.target.value) })}
          />
          <span className="shrink-0 font-bold text-gold-700">د.ل</span>
        </div>

        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => onChange({ files: Array.from(e.target.files ?? []) })}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className={`w-full rounded-lg border-2 border-dashed py-4 text-sm font-medium transition ${
              item.files.length > 0 ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-500"
            }`}
          >
            {item.files.length > 0 ? `✓ ${item.files.length} صورة — اضغط للتغيير` : "📷 صوّر القطعة"}
          </button>
        </div>

        <button type="button" onClick={() => setShowType((v) => !v)} className="text-xs text-slate-500 underline-offset-4 hover:underline">
          {showType || item.type ? "نوع القطعة" : "+ نوع القطعة (اختياري)"}
        </button>
        {(showType || item.type) && (
          <select className="field" value={item.type} onChange={(e) => onChange({ type: e.target.value })}>
            <option value="">—</option>
            {ITEM_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
