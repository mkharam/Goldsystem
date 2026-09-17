"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/guard";
import { db, PHOTO_BUCKET } from "@/lib/db";
import { createTicket, transitionTicket, type WeightCheck } from "@/lib/tickets";
import { resolveCustomer } from "@/lib/customers";
import { ensureFallbackBranch } from "@/lib/auth";
import { normalizeDigits } from "@/lib/constants";
import type { RepairStatus } from "@/lib/types";

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const normalized = normalizeDigits(String(value)).trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export type CreateTicketState = { error?: string } | null;

export async function createTicketAction(
  _prev: CreateTicketState,
  formData: FormData,
): Promise<CreateTicketState> {
  const staff = await requireStaff();

  const fullName = String(formData.get("customer_name") ?? "").trim();
  const phone = normalizeDigits(String(formData.get("customer_phone") ?? "")).trim();
  const itemName = String(formData.get("item_name") ?? "").trim();
  const problem = String(formData.get("problem_description") ?? "").trim();

  if (!fullName) return { error: "اسم الزبون مطلوب" };
  if (!phone) return { error: "رقم هاتف الزبون مطلوب" };
  if (!itemName) return { error: "اسم أو وصف القطعة مطلوب" };
  if (!problem) return { error: "وصف العطل مطلوب" };

  const branchId = String(formData.get("branch_id") ?? "") || staff.branch_id || (await ensureFallbackBranch());
  if (!branchId) return { error: "لا يوجد فرع — تعذّرت المزامنة مع المخزون" };

  let ticketId: string;

  try {
    const customerId = await resolveCustomer({
      customerId: String(formData.get("customer_id") ?? "") || null,
      fullName,
      phone,
    });

    const productId = String(formData.get("inventory_product_id") ?? "") || null;

    const ticket = await createTicket({
      customer_id: customerId,
      branch_id: branchId,
      received_by: staff.staff_id,
      item_source: productId ? "inventory" : "manual",
      inventory_product_id: productId,
      item_code: String(formData.get("item_code") ?? "").trim() || null,
      item_name: itemName,
      item_type: String(formData.get("item_type") ?? "").trim() || null,
      karat: String(formData.get("karat") ?? "").trim() || null,
      weight_in_grams: numberOrNull(formData.get("weight_in_grams")),
      problem_description: problem,
      estimated_cost: numberOrNull(formData.get("estimated_cost")),
      promised_at: String(formData.get("promised_at") ?? "") || null,
    });

    ticketId = ticket.id;

    const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    await uploadPhotos(ticketId, photos, "intake", staff.staff_id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "تعذّر حفظ التذكرة" };
  }

  revalidatePath("/");
  revalidatePath("/tickets");
  // الإيصال فوراً بعد الاستلام — الزبون واقف ينتظره.
  redirect(`/tickets/${ticketId}/receipt`);
}

async function uploadPhotos(
  ticketId: string,
  files: File[],
  stage: "intake" | "progress" | "delivery",
  staffId: string,
): Promise<void> {
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${ticketId}/${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

    const { error } = await db()
      .storage.from(PHOTO_BUCKET)
      .upload(path, await file.arrayBuffer(), { contentType: file.type || "image/jpeg" });

    // صورة فاشلة لا تُسقط التذكرة — الموظف يعيد رفعها من صفحة التفاصيل.
    if (error) {
      console.error("photo upload failed", path, error.message);
      continue;
    }

    await db().from("repair_photos").insert({
      ticket_id: ticketId,
      storage_path: path,
      stage,
      uploaded_by: staffId,
      // صور الاستلام والتسليم تهم الزبون؛ صور العمل الداخلي لا تُعرض علناً.
      is_public: stage !== "progress",
    });
  }
}

export type TransitionState = { error?: string; weightCheck?: WeightCheck } | null;

export async function transitionAction(
  _prev: TransitionState,
  formData: FormData,
): Promise<TransitionState> {
  const staff = await requireStaff();
  const ticketId = String(formData.get("ticket_id") ?? "");
  const to = String(formData.get("to") ?? "") as RepairStatus;

  const result = await transitionTicket({
    ticketId,
    to,
    staffId: staff.staff_id,
    note: String(formData.get("note") ?? "").trim() || null,
    workDone: formData.has("work_done") ? String(formData.get("work_done") ?? "").trim() || null : undefined,
    finalCost: formData.has("final_cost") ? numberOrNull(formData.get("final_cost")) : undefined,
    weightOut: formData.has("weight_out_grams") ? numberOrNull(formData.get("weight_out_grams")) : undefined,
    deliveredToName: String(formData.get("delivered_to_name") ?? "").trim() || null,
    varianceNote: String(formData.get("variance_note") ?? "").trim() || null,
    acceptVariance: formData.get("accept_variance") === "on",
  });

  if (!result.ok) return { error: result.error, weightCheck: result.weightCheck };

  revalidatePath("/");
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${ticketId}`);
  return null;
}

export async function addPhotosAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const ticketId = String(formData.get("ticket_id") ?? "");
  const stage = String(formData.get("stage") ?? "progress") as "intake" | "progress" | "delivery";

  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  await uploadPhotos(ticketId, photos, stage, staff.staff_id);

  revalidatePath(`/tickets/${ticketId}`);
}

/**
 * تسجيل أن الموظف أبلغ الزبون عبر واتساب.
 * الزر يفتح wa.me على جهاز الموظف — لا نرسل شيئاً آلياً، فهذا سجل "أُبلغ" فقط.
 */
export async function logNotificationAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const ticketId = String(formData.get("ticket_id") ?? "");

  await db().from("repair_notifications").insert({
    ticket_id: ticketId,
    channel: "whatsapp",
    phone: String(formData.get("phone") ?? "") || null,
    message_preview: String(formData.get("message") ?? "").slice(0, 300) || null,
    sent_by: staff.staff_id,
  });

  revalidatePath(`/tickets/${ticketId}`);
}
