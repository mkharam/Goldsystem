"use client";

import { logNotificationAction } from "@/app/actions/tickets";
import { phoneDigits } from "@/lib/constants";
import type { RepairStatus } from "@/lib/types";

function buildMessage(input: {
  customerName: string;
  ticketNumber: string;
  itemName: string;
  status: RepairStatus;
  shopName: string;
  trackUrl: string;
}): string {
  const { customerName, ticketNumber, itemName, status, shopName, trackUrl } = input;

  const body =
    status === "ready"
      ? `قطعتكم (${itemName}) جاهزة للاستلام.`
      : status === "delivered"
        ? `تم تسليم قطعتكم (${itemName}). شكراً لثقتكم.`
        : `تحديث بخصوص قطعتكم (${itemName}) قيد الصيانة لدينا.`;

  return [
    `السلام عليكم ${customerName}،`,
    body,
    `رقم التذكرة: ${ticketNumber}`,
    `لمتابعة الحالة: ${trackUrl}`,
    shopName,
  ].join("\n");
}

/**
 * يفتح واتساب على جهاز الموظف برسالة جاهزة، ويسجّل محلياً أن الزبون أُبلغ.
 *
 * لا إرسال آلي عمداً: لا يتطلب حساب أعمال ولا موافقة قوالب، والموظف يرى الرسالة
 * ويعدّلها قبل الإرسال. السجل يوثّق "أُبلغ" لا "وصلت الرسالة".
 */
export function NotifyButton({
  ticketId,
  phone,
  customerName,
  ticketNumber,
  itemName,
  status,
  shopName,
  trackUrl,
}: {
  ticketId: string;
  phone: string;
  customerName: string;
  ticketNumber: string;
  itemName: string;
  status: RepairStatus;
  shopName: string;
  trackUrl: string;
}) {
  const message = buildMessage({ customerName, ticketNumber, itemName, status, shopName, trackUrl });
  const waUrl = `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(message)}`;

  return (
    <form
      action={logNotificationAction}
      onSubmit={() => {
        // نفتح واتساب فوراً بدل انتظار الخادم — السجل أثر جانبي لا يجوز أن يؤخّر الموظف.
        window.open(waUrl, "_blank", "noopener");
      }}
    >
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="message" value={message} />
      <button type="submit" className="btn-success mt-3 w-full">
        إبلاغ الزبون عبر واتساب
      </button>
    </form>
  );
}
