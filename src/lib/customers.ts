import "server-only";
import { db } from "./db";
import { lookupCustomers, createInventoryCustomer } from "./inventory";
import { phoneDigits } from "./constants";
import type { Customer } from "./types";

export type CustomerMatch = Customer & { origin: "local" | "inventory" };

/**
 * بحث الزبون بالهاتف: محلياً أولاً (يعمل دائماً)، ثم في المخزون إن كان متاحاً.
 * النتائج مدموجة بلا تكرار — الزبون الذي سبق أن أُنشئ محلياً من سجل المخزون
 * يظهر مرة واحدة.
 */
export async function searchCustomers(phone: string): Promise<CustomerMatch[]> {
  const digits = phoneDigits(phone);
  if (digits.length < 3) return [];

  const tail = digits.slice(-6);
  const { data: local } = await db()
    .from("customers")
    .select("id, inventory_customer_id, full_name, phone, notes")
    .ilike("phone", `%${tail}%`)
    .limit(10);

  const matches: CustomerMatch[] = (local ?? []).map((c) => ({ ...c, origin: "local" as const }));
  const seenInventoryIds = new Set(matches.map((m) => m.inventory_customer_id).filter(Boolean));
  const seenPhones = new Set(matches.map((m) => phoneDigits(m.phone)));

  const remote = await lookupCustomers(digits);
  if (remote.ok) {
    for (const c of remote.data.customers) {
      if (seenInventoryIds.has(c.id)) continue;
      if (c.phone && seenPhones.has(phoneDigits(c.phone))) continue;
      matches.push({
        id: `inventory:${c.id}`,
        inventory_customer_id: c.id,
        full_name: c.full_name,
        phone: c.phone ?? "",
        notes: null,
        origin: "inventory",
      });
    }
  }

  return matches;
}

/**
 * يُرجع معرّف زبون محلي جاهز للربط بالتذكرة، منشئاً إياه عند الحاجة.
 *
 * - `inventory:<id>` يعني أن الموظف اختار زبوناً من المخزون لم يُنسخ محلياً بعد.
 * - غياب المعرّف يعني زبوناً جديداً؛ نحاول تسجيله في المخزون أيضاً ليبقى سجل
 *   الزبائن موحّداً، لكن فشل ذلك لا يمنع فتح التذكرة.
 */
export async function resolveCustomer(input: {
  customerId?: string | null;
  fullName: string;
  phone: string;
  inventoryBranchId?: string | null;
}): Promise<string> {
  const { customerId, fullName, phone } = input;

  if (customerId && !customerId.startsWith("inventory:")) return customerId;

  const inventoryId = customerId?.startsWith("inventory:") ? customerId.slice("inventory:".length) : null;

  if (inventoryId) {
    const { data: existing } = await db()
      .from("customers")
      .select("id")
      .eq("inventory_customer_id", inventoryId)
      .maybeSingle();
    if (existing) return existing.id;

    const { data: created, error } = await db()
      .from("customers")
      .insert({ inventory_customer_id: inventoryId, full_name: fullName, phone })
      .select("id")
      .single();
    if (error || !created) throw new Error("تعذّر حفظ بيانات الزبون");
    return created.id;
  }

  // زبون جديد تماماً — نحاول إضافته للمخزون لتبقى السجلات موحّدة.
  const remote = await createInventoryCustomer({
    full_name: fullName,
    phone,
    branch_id: input.inventoryBranchId ?? null,
  });

  const { data: created, error } = await db()
    .from("customers")
    .insert({
      full_name: fullName,
      phone,
      inventory_customer_id: remote.ok ? remote.data.customer.id : null,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error("تعذّر حفظ بيانات الزبون");
  return created.id;
}
