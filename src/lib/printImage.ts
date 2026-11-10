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

type Source = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number };

const MAX_PHOTO_PX = 1800;

const loadImage = (src: string, crossOrigin = false) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** يصغّر الصور الكبيرة (صور الكاميرا 12 ميغابكسل) — iOS يفشل بصمت في رسمها وهي بحجمها الأصلي. */
function downscale(img: HTMLImageElement): Source {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const k = Math.min(1, MAX_PHOTO_PX / Math.max(w, h));
  if (k >= 1) return img as Source;
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return c as Source;
}

/** يجلب صورة من أصل آخر ويعيدها مصدراً صالحاً للرسم على لوحة، أو null إن تعذّر. */
async function fetchPhoto(src: string): Promise<Source | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(src, { mode: "cors", cache: attempt ? "reload" : "default" });
      if (!res.ok) continue;
      const url = URL.createObjectURL(await res.blob());
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      if (img && img.naturalWidth) return downscale(img);
    } catch { /* نعيد المحاولة ثم البديل */ }
  }
  const viaTag = await loadImage(src, true);
  return viaTag && viaTag.naturalWidth ? downscale(viaTag) : null;
}

type Slot = { src: string; x: number; y: number; w: number; h: number; radius: number; fit: string };

const TRANSPARENT = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * يرسم كل ورقة إلى ملف PNG. صور القطع (روابط موقّعة من Supabase، أصل آخر) لا نتركها لـhtml2canvas —
 * كان يرسمها فارغة على iPhone — بل نخفيها أثناء رسمه ثم نرسمها نحن فوق اللوحة بنفس موضعها وقصّها
 * (cover) وتدوير زواياها، بعد تصغيرها. `missing` عدد الصور التي تعذّر رسمها، ليُنبَّه الموظف.
 */
export async function renderSheetsToFiles(
  sheets: HTMLElement[],
  baseName: string,
): Promise<{ files: File[]; missing: number }> {
  const { default: html2canvas } = await import("html2canvas");
  const isRemote = (src: string) => /^https?:/i.test(src) && new URL(src).origin !== location.origin;

  // html2canvas يقرأ أنماط ::before/::after من الصفحة الحيّة لا من نسختها، ويفشل (createPattern على
  // لوحة صفرية) مع خطوط الزخرفة الأقل من بكسل وتدرّجاتها وborder-image. هذا الصنف يحوّلها لخطوط
  // سادة بسماكة بكسل طوال التصدير فقط (راجع .a5-exporting في index.css).
  sheets.forEach((el) => el.classList.add("a5-exporting"));
  const files: File[] = [];
  let missing = 0;
  const hidden: { img: HTMLImageElement; prev: string }[] = [];
  try {
    // كل الصور الخارجية دفعة واحدة (الورقة المجمّعة قد تضم عدة قطع).
    const photos = new Map<string, Source | null>();
    const remote = new Set<string>();
    sheets.forEach((sheet) => sheet.querySelectorAll("img").forEach((img) => { if (isRemote(img.src)) remote.add(img.src); }));
    await Promise.all([...remote].map(async (src) => { photos.set(src, await fetchPhoto(src)); }));

    for (let i = 0; i < sheets.length; i++) {
      const el = sheets[i];
      const box = el.getBoundingClientRect();

      // مواضع الصور (بعد تطبيق .a5-exporting) ثم إخفاؤها عن html2canvas.
      const slots: Slot[] = [];
      el.querySelectorAll("img").forEach((img) => {
        if (!isRemote(img.src)) return;
        const r = img.getBoundingClientRect();
        const cs = getComputedStyle(img);
        slots.push({
          src: img.src,
          x: r.left - box.left,
          y: r.top - box.top,
          w: r.width,
          h: r.height,
          radius: parseFloat(cs.borderTopLeftRadius) || 0,
          fit: cs.objectFit,
        });
        hidden.push({ img, prev: img.style.visibility });
        img.style.visibility = "hidden";
      });

      // ورقة طويلة (قطع كثيرة) بدقة أقل حتى لا تتجاوز ذاكرة اللوحة في iOS.
      const scale = el.offsetHeight > 1600 ? 2 : 3;
      const canvas = await html2canvas(el, {
        scale,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        ignoreElements: (node) => node instanceof HTMLElement && node.classList.contains("no-print"),
        onclone: (doc) => {
          // الصور الخارجية مخفية أصلاً؛ نستبدل مصدرها بنقطة شفافة حتى لا يحاول html2canvas جلبها.
          doc.querySelectorAll("img").forEach((img) => { if (isRemote(img.src)) img.src = TRANSPARENT; });
        },
      });

      const ctx = canvas.getContext("2d");
      for (const slot of slots) {
        const source = photos.get(slot.src);
        if (!ctx || !source) { missing++; continue; }
        const sw0 = (source as HTMLImageElement).naturalWidth ?? source.width;
        const sh0 = (source as HTMLImageElement).naturalHeight ?? source.height;
        let sx = 0, sy = 0, sw = sw0, sh = sh0;
        if (slot.fit === "cover") {
          const ir = sw0 / sh0, br = slot.w / slot.h;
          if (ir > br) { sw = sh0 * br; sx = (sw0 - sw) / 2; } else { sh = sw0 / br; sy = (sh0 - sh) / 2; }
        }
        const X = slot.x * scale, Y = slot.y * scale, W = slot.w * scale, H = slot.h * scale;
        ctx.save();
        // html2canvas يترك على السياق تحويل التكبير (scale) الذي رسم به، فنعيده للمطابقة قبل الرسم.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        const rad = Math.min(slot.radius * scale, W / 2, H / 2);
        ctx.moveTo(X + rad, Y);
        ctx.arcTo(X + W, Y, X + W, Y + H, rad);
        ctx.arcTo(X + W, Y + H, X, Y + H, rad);
        ctx.arcTo(X, Y + H, X, Y, rad);
        ctx.arcTo(X, Y, X + W, Y, rad);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(source, sx, sy, sw, sh, X, Y, W, H);
        ctx.restore();
      }

      hidden.splice(0).forEach(({ img, prev }) => { img.style.visibility = prev; });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) files.push(new File([blob], `${baseName}-${i + 1}.png`, { type: "image/png" }));
    }
  } finally {
    hidden.splice(0).forEach(({ img, prev }) => { img.style.visibility = prev; });
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
