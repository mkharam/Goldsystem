import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY مطلوبان — راجع .env");
}

/**
 * عميل Supabase في المتصفح بالمفتاح العلني.
 *
 * هذا المفتاح ليس سرّاً ولا يمنح شيئاً بذاته: كل صلاحية يقرّرها سياق المستخدم
 * المسجَّل عبر سياسات RLS. الحارس الفعلي للبيانات هو تلك السياسات وحدها.
 */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const FUNCTIONS_URL = `${url.replace(/\/+$/, "")}/functions/v1`;
export const PHOTO_BUCKET = "repair-photos";

/** رابط موقّع قصير العمر لعرض صورة — الحاوية خاصة ولا تُقدَّم علناً. */
export async function signedPhotoUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, expiresIn);
  const out: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) out[entry.path] = entry.signedUrl;
  }
  return out;
}
