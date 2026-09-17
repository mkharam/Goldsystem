import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { supabase, PHOTO_BUCKET } from "@/lib/supabase";
import { inventoryHealth, lookupItem } from "@/lib/inventory";
import {
  searchCustomers, resolveCustomer, createTicket, getSettings,
  type CustomerMatch,
} from "@/lib/tickets";
import { KARAT_OPTIONS, ITEM_TYPE_OPTIONS, normalizeDigits } from "@/lib/constants";

type Branch = { id: string; name: string; code: string | null };

function defaultPromisedAt(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  // قيمة datetime-local محلية لا UTC، وإلا ظهر موعد مزاح بفارق المنطقة.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T18:00`;
}

export default function NewTicket() {
  const { staff } = useAuth();
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [inventoryDown, setInventoryDown] = useState(false);
  const [promisedAt, setPromisedAt] = useState("");

  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);

  const [code, setCode] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "searching" | "found" | "not_found" | "unavailable">("idle");
  const [productId, setProductId] = useState("");
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

  async function onLookupCode() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLookupState("searching");

    const res = await lookupItem(trimmed);
    if (res.ok && res.data.item) {
      const item = res.data.item;
      setProductId(item.product_id ?? "");
      setItemName(item.name ?? "");
      setItemType(item.item_type ?? "");
      setKarat(item.karat ?? "");
      setWeight(item.weight_grams !== null ? String(item.weight_grams) : "");
      // القطعة المباعة تحمل بيانات مشتريها — نعبّئ الزبون إن لم يُختر بعد.
      if (item.sale?.customer_phone && !customerId && !phone) {
        setPhone(item.sale.customer_phone);
        setCustomerName(item.sale.customer_name ?? "");
      }
      setLookupState("found");
    } else if (!res.ok && res.reason === "not_found") {
      setLookupState("not_found");
    } else {
      setLookupState("unavailable");
    }
  }

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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const name = customerName.trim();
    const digits = normalizeDigits(phone).trim();
    if (!name) return setError("اسم الزبون مطلوب");
    if (!digits) return setError("رقم هاتف الزبون مطلوب");
    if (!itemName.trim()) return setError("اسم أو وصف القطعة مطلوب");
    if (!problem.trim()) return setError("وصف العطل مطلوب");
    if (!branchId) return setError("اختر الفرع");

    setBusy(true);
    try {
      const resolvedCustomerId = await resolveCustomer({ customerId: customerId || null, fullName: name, phone: digits });

      const ticket = await createTicket({
        customer_id: resolvedCustomerId,
        branch_id: branchId,
        received_by: staff!.staff_id,
        item_source: productId ? "inventory" : "manual",
        inventory_product_id: productId || null,
        item_code: code.trim() || null,
        item_name: itemName.trim(),
        item_type: itemType || null,
        karat: karat || null,
        weight_in_grams: weight.trim() ? Number(normalizeDigits(weight)) : null,
        problem_description: problem.trim(),
        estimated_cost: estimatedCost.trim() ? Number(normalizeDigits(estimatedCost)) : null,
        promised_at: promisedAt ? new Date(promisedAt).toISOString() : null,
      });

      await uploadPhotos(ticket.id);
      // الإيصال فوراً بعد الاستلام — الزبون واقف ينتظره.
      navigate(`/tickets/${ticket.id}/receipt`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر حفظ التذكرة");
      setBusy(false);
    }
  }

  const lookupMessage: Record<string, { text: string; className: string }> = {
    searching: { text: "جارٍ البحث…", className: "text-slate-500" },
    found: { text: "تم العثور على القطعة وتعبئة بياناتها", className: "text-brand-700" },
    not_found: { text: "لا توجد قطعة بهذا الكود — أكمل الإدخال يدوياً", className: "text-gold-700" },
    unavailable: { text: "المخزون غير متاح — أكمل الإدخال يدوياً", className: "text-gold-700" },
  };

  return (
    <AppShell inventoryDown={inventoryDown}>
      <h1 className="mb-4 text-lg font-bold text-slate-900">استلام قطعة للصيانة</h1>

      <form onSubmit={onSubmit} className="space-y-5">
        {/* ——— الزبون ——— */}
        <section className="card p-4">
          <h2 className="mb-3 font-bold text-slate-900">الزبون</h2>

          <div className="relative">
            <label className="label" htmlFor="phone">رقم الهاتف</label>
            <input
              id="phone"
              type="text"
              inputMode="tel"
              dir="ltr"
              className="field text-left"
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
                      className="flex w-full items-center justify-between px-3 py-2.5 text-right hover:bg-gold-50"
                    >
                      <span>
                        <span className="block font-medium text-slate-900">{m.full_name}</span>
                        <span className="block text-xs text-slate-500" dir="ltr">{m.phone}</span>
                      </span>
                      {m.origin === "inventory" && (
                        <span className="badge border-slate-200 bg-slate-100 text-slate-600">من المخزون</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3">
            <label className="label" htmlFor="customer_name">الاسم</label>
            <input
              id="customer_name"
              className="field"
              placeholder="اسم الزبون"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>

          {customerId && (
            <button
              type="button"
              onClick={() => { setCustomerId(""); setCustomerName(""); setPhone(""); }}
              className="mt-2 text-sm text-gold-700 hover:underline"
            >
              زبون آخر
            </button>
          )}
        </section>

        {/* ——— القطعة ——— */}
        <section className="card p-4">
          <h2 className="mb-3 font-bold text-slate-900">القطعة</h2>

          <label className="label" htmlFor="code">كود القطعة</label>
          <div className="flex gap-2">
            <input
              id="code"
              className="field flex-1"
              placeholder="امسح أو اكتب الكود"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                // الماسح الضوئي يُرسل Enter بعد الكود؛ نمنع إرسال النموذج كاملاً.
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onLookupCode();
                }
              }}
            />
            <button type="button" onClick={onLookupCode} className="btn-ghost shrink-0" disabled={!code.trim()}>
              بحث
            </button>
          </div>

          {lookupState !== "idle" && lookupMessage[lookupState] && (
            <p className={`mt-1.5 text-sm ${lookupMessage[lookupState].className}`}>
              {lookupMessage[lookupState].text}
            </p>
          )}
          {inventoryDown && lookupState === "idle" && (
            <p className="mt-1.5 text-sm text-gold-700">المخزون غير متاح — الإدخال يدوي</p>
          )}

          <div className="mt-3">
            <label className="label" htmlFor="item_name">اسم القطعة / وصفها</label>
            <input
              id="item_name"
              className="field"
              placeholder="مثال: خاتم ذهب بفص"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="item_type">النوع</label>
              <select id="item_type" className="field" value={itemType} onChange={(e) => setItemType(e.target.value)}>
                <option value="">—</option>
                {ITEM_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="karat">العيار</label>
              <select id="karat" className="field" value={karat} onChange={(e) => setKarat(e.target.value)}>
                <option value="">—</option>
                {KARAT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="label" htmlFor="weight">الوزن عند الاستلام (غرام)</label>
            <input
              id="weight"
              type="text"
              inputMode="decimal"
              dir="ltr"
              className="field text-left"
              placeholder="0.000"
              value={weight}
              onChange={(e) => setWeight(normalizeDigits(e.target.value))}
            />
            <p className="mt-1 text-xs text-slate-500">يُقارَن بوزن التسليم للتأكد من عدم نقصان الذهب</p>
          </div>
        </section>

        {/* ——— العمل ——— */}
        <section className="card p-4">
          <h2 className="mb-3 font-bold text-slate-900">العمل المطلوب</h2>

          <label className="label" htmlFor="problem">وصف العطل</label>
          <textarea
            id="problem"
            rows={3}
            className="field"
            placeholder="مثال: كسر في المشبك، تلميع، تصغير مقاس"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
          />

          <div className="mt-3 grid grid-cols-2 gap-3">
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
          </div>

          {branches.length > 1 && (
            <div className="mt-3">
              <label className="label" htmlFor="branch">الفرع</label>
              <select id="branch" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
        </section>

        {/* ——— الصور ——— */}
        <section className="card p-4">
          <h2 className="mb-1 font-bold text-slate-900">صور القطعة</h2>
          <p className="mb-3 text-xs text-slate-500">صوّر القطعة عند الاستلام — دليل حالتها قبل العمل عليها</p>

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <button type="button" onClick={() => fileInput.current?.click()} className="btn-ghost w-full py-3">
            {files.length > 0 ? `${files.length} صورة محدّدة — تغيير` : "التقاط صور"}
          </button>
        </section>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

        <button type="submit" className="btn-primary w-full py-3 text-base" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "حفظ وطباعة الإيصال"}
        </button>
      </form>
    </AppShell>
  );
}
