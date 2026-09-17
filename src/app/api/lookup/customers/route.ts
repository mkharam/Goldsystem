import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { searchCustomers } from "@/lib/customers";

/** بحث الزبون أثناء الكتابة في نموذج الاستلام. */
export async function GET(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const phone = new URL(request.url).searchParams.get("phone") ?? "";
  const customers = await searchCustomers(phone);
  return NextResponse.json({ customers });
}
