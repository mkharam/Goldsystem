import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase, FUNCTIONS_URL } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

export default function Login() {
  const { staff, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!loading && staff) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDetail([]);
    const result = await signIn(email, password);
    if (!result.ok) {
      setError(result.error);
      setDetail(result.detail);
    }
    setBusy(false);
  }

  /** فحص الاتصال — يفصل عطل الشبكة عن خطأ البيانات، وكلاهما يبدو متشابهاً للمستخدم. */
  async function runDiagnostics() {
    setBusy(true);
    setError(null);
    const lines: string[] = [];

    lines.push(`العنوان: ${window.location.href}`);

    try {
      const started = Date.now();
      const { error: pingError } = await supabase.from("settings").select("key").limit(1);
      const ms = Date.now() - started;
      // المتوقّع رفض الصلاحية لأننا غير مسجّلين: يعني أن الشبكة تصل وRLS تعمل.
      lines.push(pingError ? `قاعدة البيانات: ردّت خلال ${ms}ms — ${pingError.code ?? ""} ${pingError.message}` : `قاعدة البيانات: وصلت خلال ${ms}ms`);
    } catch (err) {
      lines.push(`قاعدة البيانات: تعذّر الوصول — ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const res = await fetch(`${FUNCTIONS_URL}/track?token=00000000000000000000000000000000`);
      lines.push(`دوال الحافة: ${res.status} (المتوقّع 404 = تعمل)`);
    } catch (err) {
      lines.push(`دوال الحافة: تعذّر الوصول — ${err instanceof Error ? err.message : String(err)}`);
    }

    setDetail(lines);
    setBusy(false);
  }

  return (
    <div className="brand-surface flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-gold-600/25 bg-white p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <Logo size={88} className="mx-auto mb-4 shadow-lg" />
          <h1 className="text-xl font-bold text-brand-800">متابعة الصيانة</h1>
          <div className="brand-hairline my-3" />
          <p className="text-sm text-slate-500">ادخل بحسابك في نظام المخزون</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">البريد الإلكتروني</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              className="field text-left"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="password">كلمة المرور</label>
            <div className="relative">
              <input
                id="password"
                // إظهار الحرف يمنع نصف مشاكل الدخول على الهاتف: التعبئة التلقائية
                // تملأ كلمة قديمة، ولوحة المفاتيح تضيف حرفاً كبيراً، ولا شيء يكشف ذلك.
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                dir="ltr"
                className="field text-left pl-20"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md border border-slate-200
                           bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
              >
                {showPassword ? "إخفاء" : "إظهار"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {password.length > 0 ? `عدد المحارف: ${password.length}` : " "}
            </p>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? "جارٍ الدخول…" : "دخول"}
          </button>
        </form>

        <button
          type="button"
          onClick={runDiagnostics}
          disabled={busy}
          className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-600"
        >
          فحص الاتصال
        </button>

        {detail.length > 0 && (
          <div className="mt-3 rounded-lg bg-slate-900 p-3">
            <p className="mb-1 text-[10px] font-semibold text-slate-400">تفاصيل تقنية</p>
            <ul className="space-y-1">
              {detail.map((line, i) => (
                <li key={i} className="break-all font-mono text-[10px] leading-relaxed text-lime-300" dir="ltr">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
