// بحث بلغة الموظف: يفهم التاريخ كما يُقال في المحل («امس»، «الاسبوع الي فات»، «السبت»،
// «الشهر الماضي»، «سبتمبر»، «قبل 3 ايام»، «28/9») ويفصله عن بقية الكلام، فـ«محمد امس»
// = تذاكر محمد التي استُلمت أمس. ما بقي بعد التاريخ يُبحث به نصاً (الاسم، الهاتف، القطعة…).

export type DateRange = { from: Date; to: Date; label: string };
export type SmartQuery = { range: DateRange | null; text: string };

/** نفس تطبيع قاعدة البيانات (ar_norm) مع إبقاء المسافات: أ/إ/آ→ا، ة→ه، ى→ي، بلا تشكيل. */
export function arNorm(s: string): string {
  return s
    // أرقام عربية/فارسية ← لاتينية، والنص كما هو (normalizeDigits في constants تحذف غير الأرقام).
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[ً-ْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayRange = (d: Date, label: string): DateRange => ({ from: startOfDay(d), to: addDays(d, 1), label });

// الأسبوع في ليبيا يبدأ السبت.
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 1) % 7));

const WEEKDAYS: [string[], number][] = [
  [["الاحد", "احد"], 0],
  [["الاثنين", "الاتنين", "اثنين", "اتنين"], 1],
  [["الثلاثاء", "الثلاثا", "التلات", "التلاتاء", "ثلاثاء"], 2],
  [["الاربعاء", "الاربعا", "الاربع", "اربعاء"], 3],
  [["الخميس", "خميس"], 4],
  [["الجمعه", "جمعه"], 5],
  [["السبت", "سبت"], 6],
];

// الأسماء الميلادية والليبية معاً.
const MONTHS: [string[], number][] = [
  [["يناير", "اي النار", "اينار"], 0],
  [["فبراير", "النوار"], 1],
  [["مارس", "الربيع"], 2],
  [["ابريل", "الطير"], 3],
  [["مايو", "الماء"], 4],
  [["يونيو", "يونيه", "الصيف"], 5],
  [["يوليو", "يوليه", "ناصر"], 6],
  [["اغسطس", "هانيبال"], 7],
  [["سبتمبر", "الفاتح"], 8],
  [["اكتوبر", "التمور"], 9],
  [["نوفمبر", "الحرث"], 10],
  [["ديسمبر", "الكانون"], 11],
];

const MONTH_LABEL = new Intl.DateTimeFormat("ar-u-nu-latn", { month: "long", year: "numeric" });
const DAY_LABEL = new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });

type Rule = { re: RegExp; range: (m: RegExpMatchArray, now: Date) => DateRange | null };

// كلمة كاملة: لا نلتقط «امس» من داخل «سامس» مثلاً.
const W = (p: string) => new RegExp(`(?:^|\\s)(?:${p})(?=\\s|$)`);
const PAST = "(?:الماضي|الماضيه|الفايت|الفايته|الي فات|اللي فات|الي فاتت|اللي فاتت|الذي فات|اللي قبل|السابق|السابقه|فات)";

const RULES: Rule[] = [
  { re: W("اول امس|اول البارح|اول البارحه|قبل امس"), range: (_, n) => dayRange(addDays(n, -2), "أول أمس") },
  { re: W("امس|البارح|البارحه|يوم امس"), range: (_, n) => dayRange(addDays(n, -1), "أمس") },
  { re: W("اليوم|اليوم هذا|هذا اليوم"), range: (_, n) => dayRange(n, "اليوم") },
  {
    re: W(`الاسبوع ${PAST}`),
    range: (_, n) => {
      const start = addDays(startOfWeek(n), -7);
      return { from: start, to: addDays(start, 7), label: "الأسبوع الماضي" };
    },
  },
  {
    re: W("هذا الاسبوع|الاسبوع هذا|الاسبوع ده|هالاسبوع|الاسبوع"),
    range: (_, n) => ({ from: startOfWeek(n), to: addDays(startOfDay(n), 1), label: "هذا الأسبوع" }),
  },
  {
    re: W(`الشهر ${PAST}`),
    range: (_, n) => {
      const from = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      return { from, to: new Date(n.getFullYear(), n.getMonth(), 1), label: MONTH_LABEL.format(from) };
    },
  },
  {
    re: W("هذا الشهر|الشهر هذا|هالشهر|الشهر"),
    range: (_, n) => ({ from: new Date(n.getFullYear(), n.getMonth(), 1), to: addDays(startOfDay(n), 1), label: "هذا الشهر" }),
  },
  {
    re: /(?:^|\s)(?:اخر|آخر)\s+(\d{1,3})\s*(?:ايام|يوم)(?=\s|$)/,
    range: (m, n) => {
      const k = Number(m[1]);
      return { from: addDays(startOfDay(n), -(k - 1)), to: addDays(startOfDay(n), 1), label: `آخر ${k} أيام` };
    },
  },
  {
    re: /(?:^|\s)قبل\s+(\d{1,3})\s*(?:ايام|يوم)(?=\s|$)/,
    range: (m, n) => dayRange(addDays(n, -Number(m[1])), `قبل ${m[1]} أيام`),
  },
  { re: W("قبل يومين"), range: (_, n) => dayRange(addDays(n, -2), "قبل يومين") },
  {
    re: W("قبل اسبوع"),
    range: (_, n) => ({ from: addDays(startOfDay(n), -7), to: addDays(startOfDay(n), -6), label: "قبل أسبوع" }),
  },
  // تاريخ بالأرقام: 28/9 أو 28-9-2026 أو 2026-09-28
  {
    re: /(?:^|\s)(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)(?=\s|$)/,
    range: (m, n) => {
      const t = m[1];
      let y: number, mo: number, d: number;
      const iso = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
      else {
        const p = t.split(/[-/.]/).map(Number);
        [d, mo] = [p[0], p[1]];
        y = p[2] ? (p[2] < 100 ? 2000 + p[2] : p[2]) : n.getFullYear();
      }
      const date = new Date(y, mo - 1, d);
      if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
      return dayRange(date, DAY_LABEL.format(date));
    },
  },
];

function weekdayRule(q: string, now: Date): { range: DateRange; match: string } | null {
  for (const [names, dow] of WEEKDAYS) {
    for (const name of names) {
      const m = q.match(new RegExp(`(?:^|\\s)(?:يوم\\s+)?${name}(\\s+${PAST})?(?=\\s|$)`));
      if (!m) continue;
      // آخر يوم بهذا الاسم (اليوم نفسه إن وافق)، و«السبت الماضي» = الذي قبله.
      let back = (now.getDay() - dow + 7) % 7;
      if (m[1] && back === 0) back = 7;
      const date = addDays(now, -back);
      return { range: dayRange(date, DAY_LABEL.format(date)), match: m[0] };
    }
  }
  return null;
}

function monthRule(q: string, now: Date): { range: DateRange; match: string } | null {
  for (const [names, idx] of MONTHS) {
    for (const name of names) {
      const m = q.match(new RegExp(`(?:^|\\s)(?:شهر\\s+)?${name}(?:\\s+(\\d{4}))?(?=\\s|$)`));
      if (!m) continue;
      // بلا سنة: أقرب شهر بهذا الاسم لم يأتِ بعد في المستقبل.
      let y = m[1] ? Number(m[1]) : now.getFullYear();
      if (!m[1] && idx > now.getMonth()) y -= 1;
      const from = new Date(y, idx, 1);
      return { range: { from, to: new Date(y, idx + 1, 1), label: MONTH_LABEL.format(from) }, match: m[0] };
    }
  }
  return null;
}

/** يفصل التاريخ (إن وُجد) عن بقية نص البحث. */
export function parseSmartSearch(raw: string, now = new Date()): SmartQuery {
  const q = arNorm(raw);
  if (!q) return { range: null, text: "" };

  for (const rule of RULES) {
    const m = q.match(rule.re);
    if (!m) continue;
    const range = rule.range(m, now);
    if (!range) continue;
    return { range, text: q.replace(m[0], " ").replace(/\s+/g, " ").trim() };
  }
  const found = weekdayRule(q, now) ?? monthRule(q, now);
  if (found) return { range: found.range, text: q.replace(found.match, " ").replace(/\s+/g, " ").trim() };
  return { range: null, text: q };
}

export { DAY };
