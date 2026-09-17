"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { transitionAction, type TransitionState } from "@/app/actions/tickets";
import { ALLOWED_TRANSITIONS, REPAIR_STATUS, normalizeDigits } from "@/lib/constants";
import type { RepairStatus } from "@/lib/types";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-success w-full py-3" disabled={pending}>
      {pending ? "جارٍ الحفظ…" : label}
    </button>
  );
}

export function StatusActions({
  ticketId,
  status,
  weightIn,
  tolerance,
  customerName,
}: {
  ticketId: string;
  status: RepairStatus;
  weightIn: number | null;
  tolerance: number;
  customerName: string;
}) {
  const [state, formAction] = useActionState<TransitionState, FormData>(transitionAction, null);
  const [target, setTarget] = useState<RepairStatus | null>(null);
  const [weightOut, setWeightOut] = useState("");

  const options = ALLOWED_TRANSITIONS[status];

  // فرق الوزن يُحسب في المتصفح أثناء الكتابة ليرى الموظف النتيجة قبل الإرسال،
  // لكن القرار النهائي يتّخذه الخادم — هذا عرض مساعد لا تحقّق أمني.
  const difference =
    weightIn !== null && weightOut.trim() !== "" && Number.isFinite(Number(weightOut))
      ? Number((Number(weightOut) - weightIn).toFixed(3))
      : null;
  const exceedsTolerance = difference !== null && Math.abs(difference) > tolerance;

  if (!target) {
    return (
      <section className="card mb-4 p-4">
        <h2 className="mb-3 font-bold text-slate-900">تغيير الحالة</h2>
        <div className="grid gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTarget(option)}
              className={option === "delivered" ? "btn-success py-3" : "btn-ghost py-3"}
            >
              {option === "cancelled" ? "إلغاء التذكرة" : REPAIR_STATUS[option].label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const isDelivery = target === "delivered";
  const isReady = target === "ready";

  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">
          {isDelivery ? "تسليم القطعة" : REPAIR_STATUS[target].label}
        </h2>
        <button type="button" onClick={() => setTarget(null)} className="text-sm text-slate-500 hover:underline">
          إلغاء
        </button>
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="ticket_id" value={ticketId} />
        <input type="hidden" name="to" value={target} />

        {isReady && (
          <>
            <div>
              <label className="label" htmlFor="work_done">
                ما تم تنفيذه
              </label>
              <textarea id="work_done" name="work_done" rows={2} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="final_cost">
                التكلفة النهائية
              </label>
              <input
                id="final_cost"
                name="final_cost"
                type="text"
                inputMode="decimal"
                dir="ltr"
                className="field text-left"
              />
            </div>
          </>
        )}

        {isDelivery && (
          <>
            {weightIn !== null && (
              <div>
                <label className="label" htmlFor="weight_out_grams">
                  الوزن عند التسليم (غرام)
                </label>
                <input
                  id="weight_out_grams"
                  name="weight_out_grams"
                  type="text"
                  inputMode="decimal"
                  required
                  dir="ltr"
                  className="field text-left"
                  value={weightOut}
                  onChange={(e) => setWeightOut(normalizeDigits(e.target.value))}
                  placeholder="0.000"
                />
                <p className="mt-1 text-xs text-slate-500">
                  وزن الاستلام كان {weightIn.toFixed(3)} غ — المسموح ±{tolerance} غ
                </p>

                {difference !== null && (
                  <div
                    className={`mt-2 rounded-lg px-3 py-2 text-sm ${
                      exceedsTolerance ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-800"
                    }`}
                  >
                    الفرق: {difference > 0 ? "+" : ""}
                    {difference.toFixed(3)} غ
                    {exceedsTolerance ? " — يتجاوز المسموح" : " — ضمن المسموح"}
                  </div>
                )}

                {exceedsTolerance && (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <label className="flex items-start gap-2 text-sm text-red-800">
                      <input type="checkbox" name="accept_variance" className="mt-1" />
                      <span>أؤكّد التسليم رغم فرق الوزن</span>
                    </label>
                    <input
                      name="variance_note"
                      className="field mt-2"
                      placeholder="سبب الفرق (مثال: استبدال فص، إزالة لحام)"
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="label" htmlFor="delivered_to_name">
                سُلّمت إلى
              </label>
              <input
                id="delivered_to_name"
                name="delivered_to_name"
                className="field"
                defaultValue={customerName}
              />
            </div>
          </>
        )}

        <div>
          <label className="label" htmlFor="note">
            ملاحظة
          </label>
          <input id="note" name="note" className="field" placeholder="اختياري" />
        </div>

        {state?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}

        <SubmitButton label={isDelivery ? "تأكيد التسليم" : `تغيير إلى ${REPAIR_STATUS[target].label}`} />
      </form>
    </section>
  );
}
