import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * عميل Supabase الوحيد في التطبيق — بمفتاح service_role وعلى الخادم فقط.
 * المتصفح لا يتصل بقاعدة البيانات إطلاقاً؛ كل قراءة وكتابة تمرّ من هنا بعد
 * التحقق من الجلسة، ولذلك سياسات RLS في المخطط مانعة بالكامل.
 */
export function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY مطلوبان — راجع .env.example");
  }

  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export const PHOTO_BUCKET = "repair-photos";

/** رابط موقّع قصير العمر لعرض صورة — الحاوية خاصة ولا تُقدَّم علناً. */
export async function signedPhotoUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data } = await db().storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

export async function signedPhotoUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await db().storage.from(PHOTO_BUCKET).createSignedUrls(paths, expiresIn);
  const out: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) out[entry.path] = entry.signedUrl;
  }
  return out;
}
