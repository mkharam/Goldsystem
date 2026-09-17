import "server-only";
import { createHmac, timingSafeEqual, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import type { SessionStaff } from "./types";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

const COOKIE = "repair_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // وردية عمل كاملة، ثم يُعاد تسجيل الدخول

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("SESSION_SECRET مطلوب (32 بايت عشوائية) — راجع .env.example");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * جلسة موقّعة في كوكي — التطبيق لا يستخدم Supabase Auth لأن الموظفين موجودون
 * أصلاً في نظام المخزون، ولا نريد نسخ حساباتهم إلى مزوّد هوية ثانٍ.
 */
export async function createSession(staff: SessionStaff): Promise<void> {
  const body = JSON.stringify({ ...staff, exp: Date.now() + MAX_AGE_SECONDS * 1000 });
  const encoded = Buffer.from(body, "utf8").toString("base64url");
  const token = `${encoded}.${sign(encoded)}`;

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionStaff | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return {
      staff_id: parsed.staff_id,
      full_name: parsed.full_name,
      role: parsed.role,
      branch_id: parsed.branch_id ?? null,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

// ——— تجزئة كلمة المرور للدخول دون اتصال بالمخزون ———
// تُكتب فقط بعد دخول ناجح عبر المخزون؛ لا ننشئ حسابات محلية من العدم.

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
