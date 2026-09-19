import type { RepairStatus, PhotoStage, StaffRole } from "./types";

export const REPAIR_STATUS: Record<RepairStatus, { label: string; className: string; dot: string }> = {
  received: { label: "مستلمة", className: "bg-gold-100 text-gold-800 border-gold-200", dot: "bg-gold-500" },
  in_progress: { label: "قيد التنفيذ", className: "bg-blue-100 text-blue-800 border-blue-200", dot: "bg-blue-500" },
  ready: { label: "جاهزة للتسليم", className: "bg-brand-100 text-brand-800 border-brand-200", dot: "bg-brand-500" },
  delivered: { label: "مسلّمة", className: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  cancelled: { label: "ملغاة", className: "bg-red-100 text-red-800 border-red-200", dot: "bg-red-400" },
};

/** الانتقالات المسموحة. التسليم لا يتم إلا من "جاهزة" حتى لا تُسلَّم قطعة لم يُنهَ عملها. */
export const ALLOWED_TRANSITIONS: Record<RepairStatus, RepairStatus[]> = {
  received: ["in_progress", "ready", "cancelled"],
  in_progress: ["ready", "received", "cancelled"],
  ready: ["delivered", "in_progress"],
  delivered: [],
  cancelled: [],
};

export const OPEN_STATUSES: RepairStatus[] = ["received", "in_progress", "ready"];

/**
 * الخطوة التالية الطبيعية لكل حالة.
 *
 * الموظف يفتح التذكرة ليفعل شيئاً واحداً غالباً، فنقدّمه كزر واحد كبير بدل
 * قائمة خيارات متساوية يضطر للاختيار منها في كل مرة. البقية تبقى متاحة خلف
 * "خيارات أخرى".
 */
export const PRIMARY_NEXT: Partial<Record<RepairStatus, { to: RepairStatus; label: string }>> = {
  received: { to: "in_progress", label: "بدء العمل" },
  in_progress: { to: "ready", label: "تمّ العمل — جاهزة للتسليم" },
  ready: { to: "delivered", label: "تسليم للزبون" },
};

export const PHOTO_STAGE: Record<PhotoStage, string> = {
  intake: "عند الاستلام",
  progress: "أثناء العمل",
  delivery: "عند التسليم",
};

export const STAFF_ROLE: Record<StaffRole, string> = {
  admin: "مدير النظام",
  manager: "مدير فرع",
  employee: "موظف",
};

export const KARAT_OPTIONS = ["18K", "21K", "22K", "24K"];

export const ITEM_TYPE_OPTIONS = ["خاتم", "سلسلة", "أسورة", "حلق", "طقم", "خلخال", "دبلة", "أخرى"];

/**
 * لوحات المفاتيح العربية تكتب أرقاماً هندية شرقية (٠١٢٣٤٥٦٧٨٩) حتى داخل حقول
 * الأرقام، والمتصفح يرفضها بصمت فيبدو الحقل معطّلاً. نمرّر كل إدخال رقمي من هنا.
 * (السلوك نفسه المعتمد في نظام المخزون.)
 */
const EASTERN_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDigits(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const eastern = EASTERN_ARABIC_DIGITS.indexOf(ch);
    const persian = eastern === -1 ? PERSIAN_DIGITS.indexOf(ch) : -1;
    if (eastern !== -1) out += String(eastern);
    else if (persian !== -1) out += String(persian);
    else if (/[0-9]/.test(ch)) out += ch;
    else if ((ch === "." || ch === "٫" || ch === "،" || ch === ",") && !out.includes(".")) out += ".";
  }
  return out;
}

/** أرقام الهواتف تُقارن بأرقامها المجرّدة فقط — الصيغ تختلف والزبون لا يكتبها بثبات. */
export function phoneDigits(phone: string): string {
  return normalizeDigits(phone).replace(/\D/g, "");
}
