const DATE_FMT = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return DATE_FMT.format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return DATETIME_FMT.format(new Date(value));
}

export function formatWeight(grams: number | null | undefined): string {
  if (grams === null || grams === undefined) return "—";
  return `${grams.toFixed(3)} غ`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ar", { maximumFractionDigits: 2 }).format(value);
}

/** فرق الأيام عن الآن: موجب = متبقٍّ، سالب = متأخّر. */
export function daysFromNow(value: string | null | undefined): number | null {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function overdueLabel(promisedAt: string | null | undefined): string | null {
  const days = daysFromNow(promisedAt);
  if (days === null) return null;
  if (days < 0) return `متأخّرة ${Math.abs(days)} يوم`;
  if (days === 0) return "تستحق اليوم";
  if (days === 1) return "تستحق غداً";
  return `باقٍ ${days} يوم`;
}
