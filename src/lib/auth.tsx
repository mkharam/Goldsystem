import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, FUNCTIONS_URL } from "./supabase";
import type { SessionStaff } from "./types";

type AuthState = {
  staff: SessionStaff | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  async function signIn(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password) return { ok: false as const, error: "أدخل البريد وكلمة المرور" };

    const first = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (!first.error) return { ok: true as const };

    let provisioned: Response;
    try {
      provisioned = await fetch(`${FUNCTIONS_URL}/staff-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized, password }),
      });
    } catch {
      return { ok: false as const, error: "تعذّر الاتصال — تحقّق من الإنترنت" };
    }

    if (!provisioned.ok) {
      const body = await provisioned.json().catch(() => ({}));
      if (body.error === "invalid_credentials") {
        return { ok: false as const, error: "البريد أو كلمة المرور غير صحيحة" };
      }
      if (body.error === "inventory_unavailable" || body.error === "inventory_not_configured") {
        return {
          ok: false as const,
          error: "تعذّر الوصول لنظام المخزون، ولا يوجد حساب محفوظ لك هنا بعد",
        };
      }
      return { ok: false as const, error: "تعذّر تسجيل الدخول" };
    }

    const second = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (second.error) return { ok: false as const, error: "تعذّر تسجيل الدخول بعد تهيئة الحساب" };
    return { ok: true as const };
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
