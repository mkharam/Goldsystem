// تهيئة حساب الموظف من نظام المخزون — بلا أي سرّ مشترك.
//
// التحقق من كلمة المرور يتم بتسجيل دخول حقيقي على مشروع المخزون بمفتاحه العلني
// (وهو مفتاح مصمَّم ليعمل في المتصفح ولا يمنح شيئاً بذاته)، ثم نقرأ بيانات
// الموظف **بتوكنه هو**: سياسات المخزون تسمح لكل مستخدم بقراءة صفّه.
//
// لماذا لا نستخدم مفتاح المخزون السرّي: لأنه يتطلّب ضبط سرّ في مشروعين، وأي
// خطأ فيه يمنع كل الموظفين من الدخول. هذا المسار يعمل فوراً وبلا إعداد، ولا
// يمنح صلاحية أعلى مما يملكه الموظف أصلاً في المخزون.
//
// الدور: user_roles في المخزون مقروء للمديرين فقط، فمن تعذّر قراءة دوره يُعامل
// موظفاً — أقل صلاحية عند الشك، لا أعلاها.
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

// معرّفان علنيان: يظهران أصلاً في حزمة متصفح نظام المخزون.
const INVENTORY_URL = Deno.env.get("INVENTORY_SUPABASE_URL") ?? "https://iiyaytfdxfvjcvzlnlpp.supabase.co";
const INVENTORY_PUBLISHABLE_KEY =
  Deno.env.get("INVENTORY_SUPABASE_PUBLISHABLE_KEY") ?? "sb_publishable_QKc39JrtZOOvnjICFx_5Lw_DD33A7Ha";

// المخزون يقبل كلمات مرور قصيرة (مثل 1234) بينما Auth هنا يشترط 6 محارف على الأقل.
// كلمة المرور التي يكتبها الموظف تبقى كما هي عند التحقق من المخزون؛ أما حسابه المحلي
// فيُنشأ بها مع لاحقة ثابتة. يجب أن تطابق الدالةُ ما في src/lib/auth.tsx حرفاً بحرف.
// قرار المالك الصريح: يُقبل أن تكون كلمات المرور القصيرة في المخزون هي أضعف حلقة.
const localPassword = (p: string) => `${p}#gs-local`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return json({ error: "missing_credentials" }, 400);
  const normalizedEmail = String(email).trim().toLowerCase();

  // ——— 1. التحقق من حساب المخزون ———
  const inventory = createClient(INVENTORY_URL, INVENTORY_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: signIn, error: signInError } = await inventory.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (signInError || !signIn.user) {
    const status = (signInError as { status?: number } | null)?.status;
    // 400 من المخزون يعني بيانات خاطئة؛ ما عداه عطل في المخزون نفسه.
    if (status === 400) return json({ error: "invalid_credentials" }, 401);
    return json({ error: "inventory_unavailable", detail: signInError?.message ?? "" }, 502);
  }

  const inventoryUserId = signIn.user.id;

  // ——— 2. قراءة بيانات الموظف بتوكنه هو ———
  const asUser = createClient(INVENTORY_URL, INVENTORY_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await asUser
    .from("profiles")
    .select("id, full_name, branch_id, is_active")
    .eq("id", inventoryUserId)
    .maybeSingle();

  if (!profile) {
    await inventory.auth.signOut();
    return json({ error: "no_profile" }, 403);
  }
  // موظف موقوف في المخزون موقوف هنا أيضاً.
  if (profile.is_active === false) {
    await inventory.auth.signOut();
    return json({ error: "inactive_staff" }, 403);
  }

  const { data: roles } = await asUser.from("user_roles").select("role").eq("user_id", inventoryUserId);
  const ranked = ["admin", "manager", "employee"];
  const role = ranked.find((r) => (roles ?? []).some((x: { role: string }) => x.role === r)) ?? "employee";

  // ——— 3. مزامنة الفروع (مقروءة لأي مستخدم مسجَّل في المخزون) ———
  const { data: inventoryBranches } = await asUser
    .from("branches")
    .select("id, name, code, phone, is_active")
    .eq("is_active", true);

  await inventory.auth.signOut();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  for (const branch of inventoryBranches ?? []) {
    const { data: existing } = await admin
      .from("branches")
      .select("id")
      .eq("inventory_branch_id", branch.id)
      .maybeSingle();

    // كود الفرع يدخل في رقم التذكرة الفريد، والمخزون يسمح بتكراره بين فروع
    // (ثلاثة منها تحمل "BRA")، فنطلب كوداً فريداً بدل نسخ ما يأتي منه.
    const { data: allocated } = await admin.rpc("allocate_branch_code", {
      p_desired: branch.code,
      p_branch_id: existing?.id ?? null,
    });

    const payload = {
      inventory_branch_id: branch.id,
      name: branch.name,
      code: (allocated as string | null) ?? branch.code,
      phone: branch.phone,
      is_active: branch.is_active,
      synced_at: new Date().toISOString(),
    };
    // لا نحذف فرعاً محلياً أبداً — التذاكر تشير إليه.
    // ولا نغيّر كود فرع قائم: رقم تذكرة مطبوع لا يمكن تصحيحه بعد خروجه.
    if (existing) {
      const { code: _ignored, ...rest } = payload;
      await admin.from("branches").update(rest).eq("id", existing.id);
    } else {
      await admin.from("branches").insert(payload);
    }
  }

  let localBranchId: string | null = null;
  if (profile.branch_id) {
    const { data: branch } = await admin
      .from("branches")
      .select("id")
      .eq("inventory_branch_id", profile.branch_id)
      .maybeSingle();
    localBranchId = branch?.id ?? null;
  }

  // ——— 4. حساب Auth محلي بنفس كلمة المرور ———
  const { data: existingStaff } = await admin
    .from("staff")
    .select("id, auth_user_id")
    .eq("inventory_staff_id", inventoryUserId)
    .maybeSingle();

  let authUserId = existingStaff?.auth_user_id ?? null;

  if (authUserId) {
    // مزامنة كلمة المرور في كل دخول ناجح، وإلا بقيت القديمة تعمل هنا بعد تغييرها هناك.
    await admin.auth.admin.updateUserById(authUserId, { password: localPassword(password) });
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: localPassword(password),
      email_confirm: true,
      user_metadata: { full_name: profile.full_name },
    });

    if (createErr || !created.user) {
      // قد يكون الحساب موجوداً من محاولة سابقة لم تكتمل — نلتقطه بدل الفشل.
      const { data: list } = await admin.auth.admin.listUsers();
      const match = list?.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
      if (!match) return json({ error: "provisioning_failed", detail: createErr?.message ?? "" }, 500);
      await admin.auth.admin.updateUserById(match.id, { password: localPassword(password) });
      authUserId = match.id;
    } else {
      authUserId = created.user.id;
    }
  }

  const payload = {
    inventory_staff_id: inventoryUserId,
    email: normalizedEmail,
    full_name: profile.full_name,
    role,
    branch_id: localBranchId,
    auth_user_id: authUserId,
    is_active: true,
    last_login_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };

  if (existingStaff) await admin.from("staff").update(payload).eq("id", existingStaff.id);
  else await admin.from("staff").insert(payload);

  // لا نُرجع توكناً: التطبيق يسجّل الدخول بنفسه عبر Auth المحلي بعد هذا.
  return json({ ok: true, email: normalizedEmail, full_name: profile.full_name, role });
});
