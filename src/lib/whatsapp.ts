import { supabase } from "./supabase";
import { phoneDigits, REPAIR_STATUS } from "./constants";
import { formatWeight } from "./format";
import { trackingUrl } from "./qr";
import type { TicketWithRelations } from "./types";

/**
 * رقم بصيغة wa.me الدولية. الأرقام تُدخَل محلياً (09xxxxxxxx) بينما wa.me يشترط رمز
 * الدولة بلا صفر ولا +، وإلا فتح الرابط محادثة مع رقم غير موجود. الافتراضي ليبيا (218).
 */
export const DEFAULT_COUNTRY_CODE = "218";

export function whatsappNumber(phone: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const d = phoneDigits(phone);
  if (!d) return "";
  if (phone.trim().startsWith("+")) return d; // مكتوب دولياً أصلاً (+44…، +218…)
  if (d.startsWith("00")) return d.slice(2); // 00218…
  if (d.startsWith("0")) return countryCode + d.slice(1); // 0910…
  if (d.startsWith(countryCode) && d.length >= countryCode.length + 9) return d; // 218910…
  return countryCode + d; // 910…
}

export type WhatsAppKind = "ready" | "reminder" | "delivered" | "update";

const BODY: Record<WhatsAppKind, (item: string) => string> = {
  ready: (item) => `قطعتكم (${item}) جاهزة للاستلام.`,
  reminder: (item) => `نذكّركم بأن قطعتكم (${item}) جاهزة ولم تُستلم بعد، نسعد بزيارتكم.`,
  delivered: (item) => `تم تسليم قطعتكم (${item}). شكراً لثقتكم.`,
  update: (item) => `تحديث بخصوص قطعتكم (${item}) قيد الصيانة لدينا.`,
};

/** النوع الافتراضي المناسب لحالة التذكرة. */
export function defaultKind(status: string): WhatsAppKind {
  return status === "ready" ? "ready" : status === "delivered" ? "delivered" : "update";
}

export function buildMessage(ticket: TicketWithRelations, kind: WhatsAppKind, shopName: string): string {
  return [
    `السلام عليكم ${ticket.customer?.full_name ?? ""}،`,
    BODY[kind](ticket.item_name),
    `رقم التذكرة: ${ticket.ticket_number}`,
    kind === "delivered"
      ? `يسعدنا تقييمكم لتجربتكم (من نجمة إلى خمس): ${trackingUrl(ticket.tracking_token)}`
      : `لمتابعة الحالة: ${trackingUrl(ticket.tracking_token)}`,
    shopName,
  ].filter(Boolean).join("\n");
}

/**
 * يفتح واتساب برسالة جاهزة ويسجّل من أبلغ ومتى. الفتح أولاً (الموظف ينتظر)، والسجل أثر
 * جانبي: فشله لا يمنع الإبلاغ. يعيد false إن لم يكن للزبون رقم صالح.
 */
export async function notifyCustomer(
  ticket: TicketWithRelations,
  kind: WhatsAppKind,
  shopName: string,
  staffId: string,
): Promise<boolean> {
  const number = whatsappNumber(ticket.customer?.phone ?? "");
  if (!number) return false;
  const message = buildMessage(ticket, kind, shopName);
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  await supabase.from("repair_notifications").insert({
    ticket_id: ticket.id,
    channel: "whatsapp",
    phone: ticket.customer?.phone ?? null,
    message_preview: `[${kind}] ${message}`.slice(0, 300),
    sent_by: staffId,
  });
  return true;
}

/** رقم الفني الذي يُسأل عن القطع (يمكن تغييره من الإعدادات: repairman_phone). */
export const REPAIRMAN_PHONE = "0945600200";

export function buildRepairmanMessage(ticket: TicketWithRelations): string {
  const details = [ticket.karat, ticket.weight_in_grams !== null ? formatWeight(ticket.weight_in_grams) : null]
    .filter(Boolean)
    .join(" · ");
  const work = ticket.problem_description.replace(/\s+/g, " ").trim().slice(0, 200);
  return [
    "السلام عليكم، أسأل عن هذه القطعة:",
    `القطعة: ${ticket.item_name}${details ? ` (${details})` : ""}`,
    `رقم التذكرة: ${ticket.ticket_number}`,
    `العمل المطلوب: ${work}`,
    `الحالة: ${REPAIR_STATUS[ticket.status].label}`,
    ticket.branch?.name ? `الفرع: ${ticket.branch.name}` : "",
    "ما آخر ما وصلت إليه؟",
  ].filter(Boolean).join("\n");
}

/**
 * يفتح محادثة واتساب مع الفني برسالة جاهزة عن القطعة. على الحاسوب يفتح «برنامج» واتساب المثبّت
 * (بروتوكول whatsapp://) لا واتساب ويب — المتصفح قد يسأل مرة «فتح WhatsApp؟» فيوافَق عليه. وعلى
 * الهاتف رابط wa.me الذي يفتح التطبيق. يعيد false إن كان الرقم غير صالح.
 */
export function askRepairman(ticket: TicketWithRelations, phone: string = REPAIRMAN_PHONE): boolean {
  const number = whatsappNumber(phone);
  if (!number) return false;
  const text = encodeURIComponent(buildRepairmanMessage(ticket));
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) {
    window.open(`https://wa.me/${number}?text=${text}`, "_blank", "noopener");
  } else {
    // نقرة على رابط لا window.open: فتح بروتوكول تطبيق في تبويب جديد يترك تبويباً فارغاً.
    const a = document.createElement("a");
    a.href = `whatsapp://send?phone=${number}&text=${text}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return true;
}
