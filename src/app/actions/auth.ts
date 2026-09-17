"use server";

import { redirect } from "next/navigation";
import { login as performLogin } from "@/lib/auth";
import { destroySession } from "@/lib/session";

export type LoginState = { error?: string } | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = await performLogin(email, password);
  if (!result.ok) return { error: result.error };

  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
