import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, FUNCTIONS_URL } from "./supabase";
import type { SessionStaff } from "./types";

/**
 * `detail` سطور تشخيص خام تُعرض للمستخدم عند الفشل.
 *
 * الرسائل العربية المهذّبة تُخفي السبب الحقيقي، وتصحيح الأخطاء على هاتف لا
 * يملك كونسول شبه مستحيل — فنُظهر ما ردّه الخادم فعلاً بدل تخمينه.
 */
export type SignInResult = { ok: true } | { ok: false; error: string; detail: string[] };

type AuthState = {
  staff: SessionStaff | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function loadStaff(authUserId: string): Promise<SessionStaff | null> {
  const { data } = await supabase
    .from("staff")
    .select("id, full_name, role, branch_id, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  // حساب Auth بلا صف موظف فعّال لا يساوي شيئاً: سياسات RLS تشترط الصف نفسه،
  // فلو مرّرناه هنا لرأى الموظف واجهة فارغة دون تفسير.
  if (!data || !data.is_active) return null;

  return {
    staff_id: data.id,
    full_name: data.full_name,
    role: data.role,
    branch_id: data.branch_id,
  };
}

/**
 * حسابات المخزون تُنشأ باسم مستخدم فيُخزَّن بريداً على نطاق داخلي، والمدير العام
 * الأصلي وحده يحمل بريداً قديماً. نطابق قاعدة المخزون نفسها حرفاً بحرف، وإلا
 * لن يجد الدخول الحساب. ما فيه @ يمرّ كما هو.
 */
const USERNAME_DOMAIN = "lamaa.local";
function usernameToEmail(input: string): string {
  const v = input.trim().toLowerCase();
  if (v.includes("@")) return v;
  if (v === "admin") return "admin@lamaa.com";
  return `${v}@${USERNAME_DOMAIN}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<SessionStaff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session) setStaff(await loadStaff(data.session.user.id));
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;
      setStaff(session ? await loadStaff(session.user.id) : null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /**
   * الدخول بحساب المخزون نفسه.
   *
   * نجرّب Auth المحلي أولاً: من دخل مرة واحدة يبقى حسابه هنا، فيعمل التطبيق
   * كاملاً حتى لو كان المخزون منقطعاً. وإن فشل، نطلب من دالة staff-auth أن
   * تتحقق من المخزون وتُنشئ الحساب، ثم نعيد المحاولة.
   */
  async function signIn(username: string, password: string): Promise<SignInResult> {
    const normalized = usernameToEmail(username);
    const detail: string[] = [];
    detail.push(`المستخدم: "${username.trim()}" ← "${normalized}"`);
    detail.push(`طول كلمة المرور: ${password.length}`);

    if (!username.trim() || !password) {
      return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور", detail };
    }

    const first = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (!first.error) {
      // الدخول نجح، لكن بلا صف موظف فعّال تمنع RLS كل شيء — نقولها صراحةً بدل
      // ترك المستخدم أمام واجهة فارغة.
      const linked = await loadStaff(first.data.user.id);
      if (!linked) {
        await supabase.auth.signOut();
        detail.push("دخول Auth نجح، لكن لا يوجد صف موظف فعّال مرتبط بالحساب");
        return { ok: false, error: "الحساب موجود لكنه غير مرتبط بموظف فعّال", detail };
      }
      return { ok: true };
    }

    detail.push(`محاولة الدخول المحلي: ${first.error.status ?? "?"} ${first.error.message}`);

    let provisioned: Response;
    try {
      provisioned = await fetch(`${FUNCTIONS_URL}/staff-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized, password }),
      });
    } catch (err) {
      detail.push(`الاتصال بـ staff-auth فشل: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, error: "تعذّر الاتصال — تحقّق من الإنترنت", detail };
    }

    if (!provisioned.ok) {
      const body = await provisioned.json().catch(() => ({}));
      detail.push(`staff-auth: ${provisioned.status} ${body.error ?? ""}`.trim());

      if (body.error === "invalid_credentials") {
        return { ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة", detail };
      }
      if (body.error === "inventory_unavailable" || body.error === "inventory_not_configured") {
        return {
          ok: false,
          error: "تعذّر الوصول لنظام المخزون، ولا يوجد حساب محفوظ لك هنا بعد",
          detail,
        };
      }
      return { ok: false, error: "تعذّر تسجيل الدخول", detail };
    }

    const second = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (second.error) {
      detail.push(`الدخول بعد التهيئة: ${second.error.status ?? "?"} ${second.error.message}`);
      return { ok: false, error: "تعذّر تسجيل الدخول بعد تهيئة الحساب", detail };
    }
    return { ok: true };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStaff(null);
  }

  return (
    <AuthContext.Provider value={{ staff, loading, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth خارج AuthProvider");
  return ctx;
}
