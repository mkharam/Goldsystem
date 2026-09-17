import "server-only";
import type { InventoryItem, StaffRole } from "./types";

/**
 * عميل واجهة نظام المخزون (`repair-api`). العقد موثّق في
 * jewel-sight-manager/docs/repair-api.md
 *
 * القاعدة الحاكمة هنا: **لا شيء في هذا الملف يُفشل عملية**. كل دالة تُرجع نتيجة
 * أو `null`/قائمة فارغة، ولا ترمي استثناءً أبداً. انقطاع المخزون يعني أن الموظف
 * يُدخل البيانات يدوياً — لا أن التطبيق يتوقف.
 */

const TIMEOUT_MS = 6000; // الموظف واقف أمام الزبون؛ انتظار أطول من هذا يعني "اكتبها يدوياً"

export type InventoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "disabled" | "unreachable" | "not_found" | "unauthorized" | "error" };

function config(): { url: string; key: string } | null {
  const url = process.env.INVENTORY_API_URL;
  const key = process.env.INVENTORY_API_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function isInventoryConfigured(): boolean {
  return config() !== null;
}

async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<InventoryResult<T>> {
  const cfg = config();
  if (!cfg) return { ok: false, reason: "disabled" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${cfg.url}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.key,
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "error" };

    return { ok: true, data: (await res.json()) as T };
  } catch {
    // مهلة، DNS، انقطاع شبكة — كلها "غير متاح" من منظور الموظف.
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export type InventoryStaff = {
  staff_id: string;
  full_name: string;
  role: StaffRole;
  branch_id: string | null;
  branch_name: string | null;
};

export function loginStaff(email: string, password: string) {
  return call<{ staff: InventoryStaff }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
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
  return call<{ branches: InventoryBranch[] }>("/branches");
}

export type InventoryCustomer = {
  id: string;
  full_name: string;
  phone: string | null;
  branch_id: string | null;
};

export function lookupCustomers(phone: string) {
  return call<{ customers: InventoryCustomer[] }>(`/customers/lookup?phone=${encodeURIComponent(phone)}`);
}

export function createInventoryCustomer(input: {
  full_name: string;
  phone: string;
  branch_id?: string | null;
}) {
  return call<{ customer: InventoryCustomer }>("/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function lookupItem(code: string) {
  return call<{ item: InventoryItem }>(`/items/lookup?code=${encodeURIComponent(code)}`);
}

/**
 * تعليم القطعة "في الصيانة" أو إعادتها. اختياري تماماً: نتجاهل الفشل عمداً لأن
 * حالة القطعة في المخزون لا يجوز أن تمنع فتح تذكرة أو تسليمها للزبون.
 */
export async function setItemStatus(productId: string, status: "in_repair" | "available" | "sold"): Promise<void> {
  await call("/items/status", {
    method: "POST",
    body: JSON.stringify({ product_id: productId, status }),
  });
}

export async function inventoryHealth(): Promise<"ok" | "down" | "disabled"> {
  const cfg = config();
  if (!cfg) return "disabled";
  const res = await call<{ ok: boolean }>("/health");
  return res.ok ? "ok" : "down";
}
