import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getSession()) redirect("/");

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

        <LoginForm />
      </div>
    </div>
  );
}
