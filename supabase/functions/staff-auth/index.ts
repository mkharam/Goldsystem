// تهيئة حساب الموظف من نظام المخزون.
//
// المتصفح لا يستطيع حمل مفتاح المخزون، فالتحقق يتم هنا: نمرّر بيانات الموظف إلى
// واجهة المخزون، وعند نجاحها ننشئ له حساباً في Auth الخاص بمشروع الصيانة بنفس
// كلمة المرور، ونحدّث صفّه (الاسم، الدور، الفرع).
//
// بعدها يدخل الموظف مباشرة عبر Supabase Auth بلا مرور من هنا — فيبقى الدخول
// ممكناً حتى لو انقطع المخزون تماماً، وهو شرط أساسي في هذا التطبيق.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const INVENTORY_URL = Deno.env.get("INVENTORY_API_URL");
  const INVENTORY_KEY = Deno.env.get("INVENTORY_API_KEY");
  if (!INVENTORY_URL || !INVENTORY_KEY) return json({ error: "inventory_not_configured" }, 503);

  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return json({ error: "missing_credentials" }, 400);
  const normalizedEmail = String(email).trim().toLowerCase();

  // ——— التحقق من المخزون ———
  let staff: { staff_id: string; full_name: string; role: string; branch_id: string | null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${INVENTORY_URL.replace(/\/+$/, "")}/auth/login`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-api-key": INVENTORY_KEY },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    clearTimeout(timer);

    if (res.status === 401) return json({ error: "invalid_credentials" }, 401);
    if (!res.ok) return json({ error: "inventory_unavailable" }, 502);
    staff = (await res.json()).staff;
  } catch {
    return json({ error: "inventory_unavailable" }, 502);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ——— الفرع المحلي المقابل ———
  let localBranchId: string | null = null;
  if (staff.branch_id) {
    const { data: branch } = await admin
      .from("branches")
      .select("id")
      .eq("inventory_branch_id", staff.branch_id)
      .maybeSingle();
    localBranchId = branch?.id ?? null;
  }

  // ——— حساب Auth في مشروع الصيانة ———
  const { data: existingStaff } = await admin
    .from("staff")
    .select("id, auth_user_id")
    .eq("inventory_staff_id", staff.staff_id)
    .maybeSingle();

  let authUserId = existingStaff?.auth_user_id ?? null;

  if (authUserId) {
    // مزامنة كلمة المرور مع المخزون في كل دخول ناجح، وإلا بقيت القديمة تعمل هنا
    // بعد تغييرها هناك.
    await admin.auth.admin.updateUserById(authUserId, { password });
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: staff.full_name },
    });

    if (createErr || !created.user) {
      // الحساب قد يكون موجوداً من محاولة سابقة لم تكتمل — نلتقطه بدل الفشل.
      const { data: list } = await admin.auth.admin.listUsers();
      const match = list?.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
      if (!match) return json({ error: "provisioning_failed" }, 500);
      await admin.auth.admin.updateUserById(match.id, { password });
      authUserId = match.id;
    } else {
      authUserId = created.user.id;
    }
  }

  const payload = {
    inventory_staff_id: staff.staff_id,
    email: normalizedEmail,
    full_name: staff.full_name,
    role: staff.role,
    branch_id: localBranchId,
    auth_user_id: authUserId,
    is_active: true,
    last_login_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };

  if (existingStaff) await admin.from("staff").update(payload).eq("id", existingStaff.id);
  else await admin.from("staff").insert(payload);

  // لا نُرجع توكناً: التطبيق يسجّل الدخول بنفسه عبر Supabase Auth بعد هذا.
  return json({ ok: true, email: normalizedEmail });
});
