/**
 * طباعة من iPhone داخل التطبيق المثبَّت على الشاشة الرئيسية: iOS يعطّل window.print() هناك (تعمل في
 * سفاري العادي فقط). البديل المعتمد: نحوّل كل ورقة إيصال إلى صورة PNG ونعطيها لقائمة المشاركة
 * (navigator.share)، وفيها خيار «طباعة» يفتح AirPrint.
 */

/** هل نحن في تطبيق iOS مثبَّت على الشاشة الرئيسية (لا سفاري عادي)؟ */
export function isIosStandalone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  return ios && standalone;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/**
 * يرسم كل ورقة إلى ملف PNG. صور الإيصال تأتي من روابط موقّعة من Supabase (أصل آخر): نجلبها نحن
 * أولاً كـdata URL حتى لا «تلوّث» اللوحة فيفشل التصدير؛ وما تعذّر جلبه (CORS) يُحذف من الصورة
 * المُصدَّرة فقط ولا يمسّ ما يُعرض على الشاشة.
 */
export async function renderSheetsToFiles(sheets: HTMLElement[], baseName: string): Promise<File[]> {
  const { default: html2canvas } = await import("html2canvas");

  const inline = new Map<string, string>();
  const srcs = new Set<string>();
  for (const sheet of sheets) {
    sheet.querySelectorAll("img").forEach((img) => {
      if (/^https?:/i.test(img.src) && new URL(img.src).origin !== location.origin) srcs.add(img.src);
    });
  }
  await Promise.all(
    [...srcs].map(async (src) => {
      try {
        const res = await fetch(src, { mode: "cors" });
        if (res.ok) inline.set(src, await toDataUrl(await res.blob()));
      } catch { /* يُحذف من الصورة المصدّرة */ }
    }),
  );

  // html2canvas يقرأ أنماط ::before/::after من الصفحة الحيّة لا من نسختها، ويفشل (createPattern على
  // لوحة صفرية) مع خطوط الزخرفة الأقل من بكسل وتدرّجاتها وborder-image. هذا الصنف يحوّلها لخطوط
  // سادة بسماكة بكسل طوال التصدير فقط (راجع .a5-exporting في index.css).
  sheets.forEach((el) => el.classList.add("a5-exporting"));
  const files: File[] = [];
  try {
  for (let i = 0; i < sheets.length; i++) {
    const el = sheets[i];
    // ورقة طويلة (قطع كثيرة) بدقة أقل حتى لا تتجاوز ذاكرة اللوحة في iOS.
    const scale = el.offsetHeight > 1600 ? 2 : 3;
    const canvas = await html2canvas(el, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      ignoreElements: (node) => node instanceof HTMLElement && node.classList.contains("no-print"),
      onclone: (doc) => {
        doc.querySelectorAll("img").forEach((img) => {
          const data = inline.get(img.src);
          if (data) img.src = data;
          else if (/^https?:/i.test(img.src) && new URL(img.src).origin !== location.origin) img.remove();
        });
      },
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) files.push(new File([blob], `${baseName}-${i + 1}.png`, { type: "image/png" }));
  }
  } finally {
    sheets.forEach((el) => el.classList.remove("a5-exporting"));
  }
  return files;
}

/** يفتح قائمة المشاركة (فيها «طباعة»). يعيد false إن لم يدعم الجهاز مشاركة الملفات. */
export async function shareFiles(files: File[], title: string): Promise<boolean> {
  if (!files.length) return false;
  if (!navigator.canShare?.({ files })) return false;
  try {
    await navigator.share({ files, title });
  } catch (e) {
    if ((e as { name?: string } | null)?.name !== "AbortError") throw e; // إغلاق القائمة ليس خطأ
  }
  return true;
}
