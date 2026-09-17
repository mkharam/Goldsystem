import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { staff, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && staff) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    if (!result.ok) setError(result.error);
    setBusy(false);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-gold-50 via-white to-slate-100 px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-gold-400 to-gold-600 text-2xl">
            💍
          </div>
          <h1 className="text-xl font-bold text-slate-900">متابعة الصيانة</h1>
          <p className="mt-1 text-sm text-slate-500">ادخل بحسابك في نظام المخزون</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">البريد الإلكتروني</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              dir="ltr"
              className="field text-left"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="password">كلمة المرور</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              dir="ltr"
              className="field text-left"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "جارٍ الدخول…" : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
