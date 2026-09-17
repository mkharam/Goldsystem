"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createTicketAction, type CreateTicketState } from "@/app/actions/tickets";
import { KARAT_OPTIONS, ITEM_TYPE_OPTIONS, normalizeDigits } from "@/lib/constants";
import type { InventoryItem } from "@/lib/types";

type Branch = { id: string; name: string; code: string | null };

type CustomerMatch = {
  id: string;
  full_name: string;
  phone: string;
  origin: "local" | "inventory";
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full py-3 text-base" disabled={pending}>
      {pending ? "جارٍ الحفظ…" : "حفظ وطباعة الإيصال"}
    </button>
  );
}

function defaultPromisedAt(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  // قيمة datetime-local محلية لا UTC، وإلا ظهر للموظف موعد مزاح بفارق المنطقة.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T18:00`;
}

export function NewTicketForm({
  branches,
  defaultBranchId,
  turnaroundDays,
  inventoryAvailable,
}: {
  branches: Branch[];
  defaultBranchId: string | null;
  turnaroundDays: number;
  inventoryAvailable: boolean;
}) {
  const [state, formAction] = useActionState<CreateTicketState, FormData>(createTicketAction, null);

  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [showMatches, setShowMatches] = useState(false);

  const [code, setCode] = useState("");
  const [lookupState, setLookupState] = useState<
    "idle" | "searching" | "found" | "not_found" | "unavailable"
  >("idle");
  const [productId, setProductId] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemType, setItemType] = useState("");
  const [karat, setKarat] = useState("");
  const [weight, setWeight] = useState("");

  const [photoCount, setPhotoCount] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null);

  // بحث الزبون أثناء الكتابة، بمهلة قصيرة حتى لا نستدعي الخادم على كل حرف.
  useEffect(() => {
    const digits = normalizeDigits(phone).replace(/\D/g, "");
    if (digits.length < 3 || customerId) {
      setMatches([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lookup/customers?phone=${encodeURIComponent(digits)}`);
        if (!res.ok) return;
        const body = await res.json();
        setMatches(body.customers ?? []);
        setShowMatches(true);
      } catch {
        // انقطاع الشبكة يعني إدخالاً يدوياً فقط — لا رسالة خطأ تربك الموظف.
        setMatches([]);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [phone, customerId]);

  function pickCustomer(match: CustomerMatch) {
    setCustomerId(match.id);
    setCustomerName(match.full_name);
    setPhone(match.phone);
    setShowMatches(false);
  }

  function clearCustomer() {
    setCustomerId("");
    setCustomerName("");
    setPhone("");
  }

  async function lookupCode() {
    const trimmed = code.trim();
    if (!trimmed) return;

    setLookupState("searching");
    try {
      const res = await fetch(`/api/lookup/item?code=${encodeURIComponent(trimmed)}`);
      const body = await res.json();

      if (body.status === "found" && body.item) {
        const item = body.item as InventoryItem;
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
      } else if (body.status === "not_found") {
        setLookupState("not_found");
      } else {
        setLookupState("unavailable");
      }
    } catch {
      setLookupState("unavailable");
    }
  }

  const lookupMessage: Record<string, { text: string; className: string }> = {
    searching: { text: "جارٍ البحث…", className: "text-slate-500" },
    found: { text: "تم العثور على القطعة وتعبئة بياناتها", className: "text-brand-700" },
    not_found: { text: "لا توجد قطعة بهذا الكود — أكمل الإدخال يدوياً", className: "text-gold-700" },
    unavailable: { text: "المخزون غير متاح — أكمل الإدخال يدوياً", className: "text-gold-700" },
  };

  return (
    <form action={formAction} className="space-y-5">
      {/* ——— الزبون ——— */}
      <section className="card p-4">
        <h2 className="mb-3 font-bold text-slate-900">الزبون</h2>

        <input type="hidden" name="customer_id" value={customerId} />

        <div className="relative">
          <label className="label" htmlFor="customer_phone">
            رقم الهاتف
          </label>
          <input
            id="customer_phone"
            name="customer_phone"
            type="text"
            inputMode="tel"
            required
            dir="ltr"
            className="field text-left"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (customerId) setCustomerId("");
            }}
            placeholder="09xxxxxxxx"
          />

          {showMatches && matches.length > 0 && !customerId && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => pickCustomer(match)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-right hover:bg-gold-50"
                  >
                    <span>
                      <span className="block font-medium text-slate-900">{match.full_name}</span>
                      <span className="block text-xs text-slate-500" dir="ltr">
                        {match.phone}
                      </span>
                    </span>
                    {match.origin === "inventory" && (
                      <span className="badge border-slate-200 bg-slate-100 text-slate-600">
                        من المخزون
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3">
          <label className="label" htmlFor="customer_name">
            الاسم
          </label>
          <input
            id="customer_name"
            name="customer_name"
            required
            className="field"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="اسم الزبون"
          />
        </div>

        {customerId && (
          <button type="button" onClick={clearCustomer} className="mt-2 text-sm text-gold-700 hover:underline">
            زبون آخر
          </button>
        )}
      </section>

      {/* ——— القطعة ——— */}
      <section className="card p-4">
        <h2 className="mb-3 font-bold text-slate-900">القطعة</h2>

        <input type="hidden" name="inventory_product_id" value={productId} />

        <label className="label" htmlFor="item_code">
          كود القطعة
        </label>
        <div className="flex gap-2">
          <input
            id="item_code"
            name="item_code"
            className="field flex-1"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              // الماسح الضوئي يُرسل Enter بعد الكود؛ نمنع إرسال النموذج كاملاً.
              if (e.key === "Enter") {
                e.preventDefault();
                void lookupCode();
              }
            }}
            placeholder="امسح أو اكتب الكود"
          />
          <button
            type="button"
            onClick={lookupCode}
            className="btn-ghost shrink-0"
            disabled={!inventoryAvailable || !code.trim()}
          >
            بحث
          </button>
        </div>

        {lookupState !== "idle" && lookupMessage[lookupState] && (
          <p className={`mt-1.5 text-sm ${lookupMessage[lookupState].className}`}>
            {lookupMessage[lookupState].text}
          </p>
        )}
        {!inventoryAvailable && lookupState === "idle" && (
          <p className="mt-1.5 text-sm text-gold-700">المخزون غير متاح — الإدخال يدوي</p>
        )}

        <div className="mt-3">
          <label className="label" htmlFor="item_name">
            اسم القطعة / وصفها
          </label>
          <input
            id="item_name"
            name="item_name"
            required
            className="field"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="مثال: خاتم ذهب بفص"
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="item_type">
              النوع
            </label>
            <select
              id="item_type"
              name="item_type"
              className="field"
              value={itemType}
              onChange={(e) => setItemType(e.target.value)}
            >
              <option value="">—</option>
              {ITEM_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="karat">
              العيار
            </label>
            <select
              id="karat"
              name="karat"
              className="field"
              value={karat}
              onChange={(e) => setKarat(e.target.value)}
            >
              <option value="">—</option>
              {KARAT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <label className="label" htmlFor="weight_in_grams">
            الوزن عند الاستلام (غرام)
          </label>
          <input
            id="weight_in_grams"
            name="weight_in_grams"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className="field text-left"
            value={weight}
            onChange={(e) => setWeight(normalizeDigits(e.target.value))}
            placeholder="0.000"
          />
          <p className="mt-1 text-xs text-slate-500">
            يُقارَن بوزن التسليم للتأكد من عدم نقصان الذهب
          </p>
        </div>
      </section>

      {/* ——— العطل والموعد ——— */}
      <section className="card p-4">
        <h2 className="mb-3 font-bold text-slate-900">العمل المطلوب</h2>

        <label className="label" htmlFor="problem_description">
          وصف العطل
        </label>
        <textarea
          id="problem_description"
          name="problem_description"
          required
          rows={3}
          className="field"
          placeholder="مثال: كسر في المشبك، تلميع، تصغير مقاس"
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="estimated_cost">
              التكلفة التقديرية
            </label>
            <input
              id="estimated_cost"
              name="estimated_cost"
              type="text"
              inputMode="decimal"
              dir="ltr"
              className="field text-left"
              placeholder="0"
            />
          </div>

          <div>
            <label className="label" htmlFor="promised_at">
              موعد التسليم
            </label>
            <input
              id="promised_at"
              name="promised_at"
              type="datetime-local"
              className="field"
              defaultValue={defaultPromisedAt(turnaroundDays)}
            />
          </div>
        </div>

        {branches.length > 1 && (
          <div className="mt-3">
            <label className="label" htmlFor="branch_id">
              الفرع
            </label>
            <select
              id="branch_id"
              name="branch_id"
              className="field"
              defaultValue={defaultBranchId ?? branches[0]?.id}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {branches.length === 1 && <input type="hidden" name="branch_id" value={branches[0].id} />}
      </section>

      {/* ——— الصور ——— */}
      <section className="card p-4">
        <h2 className="mb-1 font-bold text-slate-900">صور القطعة</h2>
        <p className="mb-3 text-xs text-slate-500">
          صوّر القطعة عند الاستلام — دليل حالتها قبل العمل عليها
        </p>

        <input
          ref={photoInput}
          id="photos"
          name="photos"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
        />
        <button type="button" onClick={() => photoInput.current?.click()} className="btn-ghost w-full py-3">
          {photoCount > 0 ? `${photoCount} صورة محدّدة — تغيير` : "التقاط صور"}
        </button>
      </section>

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton />
    </form>
  );
}
