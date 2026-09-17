import { supabase, FUNCTIONS_URL } from "./supabase";

/**
 * التكامل مع نظام المخزون عبر وسيط `inventory-proxy`.
 *
 * المتصفح لا يحمل مفتاح المخزون — الوسيط يحمله ويتحقق أولاً أن المتصل موظف
 * فعّال. القاعدة هنا كما كانت: **لا شيء في هذا الملف يُفشل عملية**. كل دالة
 * تُرجع نتيجة أو فشلاً موصوفاً، ولا ترمي استثناءً؛ انقطاع المخزون يعني إدخالاً
 * يدوياً لا تعطّل التطبيق.
 */

const TIMEOUT_MS = 8000;

export type InventoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unavailable" | "not_found" | "unauthorized" };

async function call<T>(path: string, init: RequestInit = {}): Promise<InventoryResult<T>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, reason: "unauthorized" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FUNCTIONS_URL}/inventory-proxy/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export type InventoryBranch = {
  id: string;
  name: string;
  name_en: string | null;
  code: string | null;
  phone: string | null;
  is_active: boolean;
};

export function fetchBranches() {
  return call<{ branches: InventoryBranch[] }>("branches");
}

export type InventoryCustomer = {
  id: string;
  full_name: string;
  phone: string | null;
  branch_id: string | null;
};

export function lookupCustomers(phone: string) {
  return call<{ customers: InventoryCustomer[] }>(`customers/lookup?phone=${encodeURIComponent(phone)}`);
}

export function createInventoryCustomer(input: { full_name: string; phone: string; branch_id?: string | null }) {
  return call<{ customer: InventoryCustomer }>("customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** اختياري تماماً: فشله لا يمنع فتح تذكرة أو تسليمها. */
export async function setItemStatus(productId: string, status: "in_repair" | "available" | "sold"): Promise<void> {
  await call("items/status", {
    method: "POST",
    body: JSON.stringify({ product_id: productId, status }),
  });
}

export async function inventoryHealth(): Promise<"ok" | "down"> {
  const res = await call<{ ok: boolean }>("health");
  return res.ok ? "ok" : "down";
}
