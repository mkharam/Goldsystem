/**
 * التطبيق المثبَّت على آيفون يتجاهل window.print()، فزر الطباعة فيه يعمل كزر مشاركة: نحوّل
 * ورقة الإيصال إلى صورة PNG مسبقاً (قبل الضغط، لأن قائمة المشاركة لا تُفتح إلا من ضغطة مباشرة
 * بلا انتظار)، وعند الضغط نفتح قائمة المشاركة بالصورة، ومنها «طباعة».
 * صور القطع في الإيصال مضمّنة أصلاً كـ data URL (PrintableImg) فتُرسم بلا مشاكل أصل آخر.
 */

export function isIosStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function renderReceiptFiles(): Promise<File[]> {
  const { default: html2canvas } = await import("html2canvas");
  const sheets = Array.from(document.querySelectorAll<HTMLElement>(".a5-sheet"));
  const files: File[] = [];
  // يحوّل الزخارف الرفيعة والتدرجات لخطوط سادة أثناء الرسم (راجع .a5-exporting في index.css).
  sheets.forEach((el) => el.classList.add("a5-exporting"));
  try {
    for (let i = 0; i < sheets.length; i++) {
      const el = sheets[i];
      const canvas = await html2canvas(el, {
        scale: el.offsetHeight > 1600 ? 2 : 3,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        ignoreElements: (n) => n instanceof HTMLElement && n.classList.contains("no-print"),
      });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (blob) files.push(new File([blob], `receipt-${i + 1}.png`, { type: "image/png" }));
    }
  } finally {
    sheets.forEach((el) => el.classList.remove("a5-exporting"));
  }
  return files;
}
