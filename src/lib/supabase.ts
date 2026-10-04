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

/** يفتح اتصال TLS بـ Supabase مبكراً — أول طلب فعلي (الدخول أو تحميل التذاكر) لا ينتظره. */
export function preconnectSupabase(): void {
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = url;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

const URL_TTL = 24 * 3600;
// نعيد استعمال الرابط حتى يبقى منه أكثر من ساعة — رابط جديد في كل تحميل يعني
// عنواناً جديداً، فيعيد المتصفح تنزيل الصورة نفسها بدل أخذها من ذاكرته.
const URL_MIN_LEFT_MS = 3600 * 1000;
const URL_CACHE_KEY = "mkh-photo-urls-v1";

type UrlCache = Record<string, { url: string; exp: number }>;

function readUrlCache(): UrlCache {
  try {
    return JSON.parse(localStorage.getItem(URL_CACHE_KEY) ?? "{}") as UrlCache;
  } catch {
    return {};
  }
}

function writeUrlCache(cache: UrlCache): void {
  const now = Date.now();
  const live = Object.entries(cache).filter(([, v]) => v.exp - now > URL_MIN_LEFT_MS);
  try {
    // نحدّ الحجم حتى لا يتضخم التخزين مع السنين: الأحدث صلاحية يبقى.
    const trimmed = live.sort((a, b) => b[1].exp - a[1].exp).slice(0, 600);
    localStorage.setItem(URL_CACHE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // التخزين ممتلئ أو معطّل — نكمل بلا ذاكرة.
  }
}

/** رابط موقّع لعرض صورة — الحاوية خاصة ولا تُقدَّم علناً. الروابط تُحفظ وتُعاد حتى قرب انتهائها. */
export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const cache = readUrlCache();
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of new Set(paths)) {
    const hit = cache[p];
    if (hit && hit.exp - now > URL_MIN_LEFT_MS) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length === 0) return out;

  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(missing, URL_TTL);
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) {
      out[entry.path] = entry.signedUrl;
      cache[entry.path] = { url: entry.signedUrl, exp: now + URL_TTL * 1000 };
    }
  }
  writeUrlCache(cache);
  return out;
}
