/**
 * ضغط الصور قبل رفعها أو حفظها في المسودّة — صورة كاميرا الهاتف تصل لعدة
 * ميغابايت، وعلى اتصال ضعيف هذا أبطأ ما في فتح التذكرة. نُصغّرها لبُعد أقصى
 * معقول للعرض ونعيد ترميزها JPEG بجودة جيدة؛ الفشل (صيغة غير مدعومة، صورة
 * تالفة) يُرجع الملف الأصلي كما هو بدل إسقاط الصورة.
 */
const MAX_DIMENSION = 1600;
const QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 400_000) {
      bitmap.close();
      return file; // صغيرة بالأصل — لا فائدة من إعادة ترميزها
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map(compressImage));
}

const THUMB_DIMENSION = 360;
const THUMB_QUALITY = 0.7;

/**
 * مصغّرة صغيرة منفصلة للعرض في القوائم (بطاقة التذكرة، معرض الصور) — الصورة
 * الكاملة (compressImage) تبقى للفتح/التنزيل، والمصغّرة فقط ما يُحمَّل حين
 * نعرض عدة صور معاً، وهذا أكثر ما يُشعَر به على اتصال ضعيف.
 */
export async function makeThumbnail(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return null; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", THUMB_QUALITY));
    if (!blob) return null;
    const name = file.name.replace(/\.\w+$/, "") + "-thumb.jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return null;
  }
}
