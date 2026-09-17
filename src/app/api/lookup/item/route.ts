import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { lookupItem } from "@/lib/inventory";

/**
 * بحث القطعة بالكود لتعبئة الوزن والعيار.
 *
 * كل حالات الفشل تُرجع 200 مع سبب مفهوم للواجهة، لأن "لم يُعثر على القطعة" و
 * "المخزون غير متاح" كلاهما نتيجة طبيعية ينتقل عندها الموظف للإدخال اليدوي —
 * لا خطأ يُعرض بلون أحمر.
 */
export async function GET(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const code = (new URL(request.url).searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ status: "empty" });

  const result = await lookupItem(code);

  if (result.ok) return NextResponse.json({ status: "found", item: result.data.item });
  if (result.reason === "not_found") return NextResponse.json({ status: "not_found" });
  if (result.reason === "disabled") return NextResponse.json({ status: "disabled" });
  return NextResponse.json({ status: "unavailable" });
}
