import "server-only";
import { db } from "./db";
import { loginStaff, fetchBranches } from "./inventory";
import { hashPassword, verifyPassword, createSession } from "./session";
import type { SessionStaff } from "./types";

export type LoginOutcome =
  | { ok: true; staff: SessionStaff; mode: "inventory" | "offline" }
  | { ok: false; error: string };

/**
 * تسجيل الدخول بحساب المخزون، مع احتياطي محلي.
 *
 * المسار الطبيعي: نتحقق من المخزون، ثم ننسخ الموظف محلياً ونخزّن تجزئة كلمة
 * المرور. عند انقطاع المخزون نتحقق من التجزئة المخزّنة — فمن دخل مرة واحدة
 * على الأقل يستطيع مواصلة العمل أثناء الانقطاع. من لم يدخل قط لا يستطيع،
 * لأننا لا ننشئ حسابات محلية من العدم.
 */
export async function login(email: string, password: string): Promise<LoginOutcome> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { ok: false, error: "أدخل البريد وكلمة المرور" };
  }

  const remote = await loginStaff(normalizedEmail, password);

  if (remote.ok) {
    const staff = await upsertStaffFromInventory(remote.data.staff, normalizedEmail, password);
    await createSession(staff);
    // مزامنة الفروع عند الدخول تُبقي النسخة المحلية حيّة بلا مهمة مجدولة.
    void syncBranches();
    return { ok: true, staff, mode: "inventory" };
  }

  // بيانات خاطئة فعلاً — لا معنى لتجربة الاحتياطي، فالمخزون هو المرجع.
  if (remote.reason === "not_found" || remote.reason === "unauthorized") {
    const offline = await tryOfflineLogin(normalizedEmail, password);
    if (offline) {
      await createSession(offline);
      return { ok: true, staff: offline, mode: "offline" };
    }
    return { ok: false, error: "البريد أو كلمة المرور غير صحيحة" };
  }

  // المخزون غير متاح (انقطاع/مهلة/غير مُعدّ) — الاحتياطي المحلي.
  const offline = await tryOfflineLogin(normalizedEmail, password);
  if (offline) {
    await createSession(offline);
    return { ok: true, staff: offline, mode: "offline" };
  }

  return {
    ok: false,
    error: "تعذّر الوصول لنظام المخزون، ولا يوجد دخول محفوظ لهذا الحساب على هذا النظام",
  };
}

async function tryOfflineLogin(email: string, password: string): Promise<SessionStaff | null> {
  const { data: staff } = await db()
    .from("staff")
    .select("id, full_name, role, branch_id, password_hash, is_active")
    .eq("email", email)
    .maybeSingle();

  if (!staff || !staff.is_active) return null;
  if (!(await verifyPassword(password, staff.password_hash))) return null;

  await db().from("staff").update({ last_login_at: new Date().toISOString() }).eq("id", staff.id);

  return {
    staff_id: staff.id,
    full_name: staff.full_name,
    role: staff.role,
    branch_id: staff.branch_id,
  };
}

async function upsertStaffFromInventory(
  remote: { staff_id: string; full_name: string; role: string; branch_id: string | null },
  email: string,
  password: string,
): Promise<SessionStaff> {
  const localBranchId = remote.branch_id ? await localBranchIdFor(remote.branch_id) : null;

  const { data: existing } = await db()
    .from("staff")
    .select("id")
    .eq("inventory_staff_id", remote.staff_id)
    .maybeSingle();

  const payload = {
    inventory_staff_id: remote.staff_id,
    email,
    full_name: remote.full_name,
    role: remote.role,
    branch_id: localBranchId,
    password_hash: await hashPassword(password),
    is_active: true,
    last_login_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };

  if (existing) {
    await db().from("staff").update(payload).eq("id", existing.id);
    return {
      staff_id: existing.id,
      full_name: remote.full_name,
      role: remote.role as SessionStaff["role"],
      branch_id: localBranchId,
    };
  }

  const { data: created, error } = await db()
    .from("staff")
    .insert(payload)
    .select("id")
    .single();

  if (error || !created) throw new Error("تعذّر حفظ بيانات الموظف محلياً");

  return {
    staff_id: created.id,
    full_name: remote.full_name,
    role: remote.role as SessionStaff["role"],
    branch_id: localBranchId,
  };
}

/** معرّف الفرع المحلي المقابل لفرع في المخزون، مع إنشائه إن لم يُزامَن بعد. */
async function localBranchIdFor(inventoryBranchId: string): Promise<string | null> {
  const { data } = await db()
    .from("branches")
    .select("id")
    .eq("inventory_branch_id", inventoryBranchId)
    .maybeSingle();
  if (data) return data.id;

  await syncBranches();

  const { data: retry } = await db()
    .from("branches")
    .select("id")
    .eq("inventory_branch_id", inventoryBranchId)
    .maybeSingle();
  return retry?.id ?? null;
}

/**
 * مزامنة الفروع من المخزون. لا تحذف فرعاً محلياً أبداً — التذاكر تشير إليه،
 * وفرع أُلغي في المخزون يُعلَّم غير فعّال فقط.
 */
export async function syncBranches(): Promise<void> {
  const remote = await fetchBranches();
  if (!remote.ok) return;

  for (const branch of remote.data.branches) {
    const { data: existing } = await db()
      .from("branches")
      .select("id")
      .eq("inventory_branch_id", branch.id)
      .maybeSingle();

    const payload = {
      inventory_branch_id: branch.id,
      name: branch.name,
      code: branch.code,
      phone: branch.phone,
      is_active: branch.is_active,
      synced_at: new Date().toISOString(),
    };

    if (existing) await db().from("branches").update(payload).eq("id", existing.id);
    else await db().from("branches").insert(payload);
  }
}

/** يضمن وجود فرع واحد على الأقل حتى يعمل التطبيق قبل أول مزامنة ناجحة. */
export async function ensureFallbackBranch(): Promise<string | null> {
  const { data: any_branch } = await db().from("branches").select("id").limit(1).maybeSingle();
  if (any_branch) return any_branch.id;

  const { data: created } = await db()
    .from("branches")
    .insert({ name: "الفرع الرئيسي", code: "01", is_active: true })
    .select("id")
    .single();
  return created?.id ?? null;
}
