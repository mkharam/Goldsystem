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

/** صورة من أصل آخر عبر <img crossOrigin> ثم لوحة — بديل إن فشل fetch. يعيد null إن تعذّر. */
const viaImageElement = (src: string) =>
  new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")?.drawImage(img, 0, 0);
        resolve(c.toDataURL("image/jpeg", 0.92));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

async function inlineImage(src: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(src, { mode: "cors", cache: attempt ? "reload" : "default" });
      if (res.ok) return await toDataUrl(await res.blob());
    } catch { /* نعيد المحاولة ثم البديل */ }
  }
  return viaImageElement(src);
}

/**
 * يرسم كل ورقة إلى ملف PNG. صور الإيصال تأتي من روابط موقّعة من Supabase (أصل آخر): نجلبها نحن
 * أولاً كـdata URL حتى لا «تلوّث» اللوحة فيفشل التصدير. `missing` عدد الصور التي تعذّر تضمينها
 * (تُحذف من الصورة المصدّرة فقط)، ليُنبَّه الموظف بدل أن تغيب بصمت.
 */
export async function renderSheetsToFiles(
  sheets: HTMLElement[],
  baseName: string,
): Promise<{ files: File[]; missing: number }> {
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
      const data = await inlineImage(src);
      if (data) inline.set(src, data);
    }),
  );
  const missing = [...srcs].filter((src) => !inline.has(src)).length;

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
  return { files, missing };
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
