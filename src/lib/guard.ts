import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import type { SessionStaff } from "./types";

/** كل صفحة محمية تبدأ من هنا — الجلسة المفقودة أو المنتهية تعيد لصفحة الدخول. */
export async function requireStaff(): Promise<SessionStaff> {
  const staff = await getSession();
  if (!staff) redirect("/login");
  return staff;
}
