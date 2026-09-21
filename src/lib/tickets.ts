import { supabase } from "./supabase";
import { OPEN_STATUSES, ALLOWED_TRANSITIONS } from "./constants";
import { setItemStatus, lookupCustomers, createInventoryCustomer, syncTickets } from "./inventory";
import { phoneDigits } from "./constants";
import type { RepairStatus, TicketWithRelations, StatusHistoryEntry, RepairPhoto, Customer } from "./types";

const TICKET_SELECT = `
  *,
  customer:customers!repair_tickets_customer_id_fkey (id, full_name, phone),
  branch:branches!repair_tickets_branch_id_fkey (id, name, code, phone),
  received_by_staff:staff!repair_tickets_received_by_fkey (full_name),
  assigned_to_staff:staff!repair_tickets_assigned_to_fkey (full_name)
`;

export type TicketFilters = {
  status?: RepairStatus | "open" | "overdue";
  branchId?: string;
  search?: string;
  limit?: number;
};

export async function listTickets(filters: TicketFilters = {}): Promise<TicketWithRelations[]> {
  let query = supabase.from("repair_tickets").select(TICKET_SELECT);

  if (filters.status === "open") query = query.in("status", OPEN_STATUSES);
  else if (filters.status === "overdue") {
    query = query.in("status", OPEN_STATUSES).lt("promised_at", new Date().toISOString());
  } else if (filters.status) query = query.eq("status", filters.status);

  if (filters.branchId) query = query.eq("branch_id", filters.branchId);

  if (filters.search?.trim()) {
    const term = filters.search.trim().replace(/[,()]/g, "");
    query = query.or(`ticket_number.ilike.%${term}%,item_name.ilike.%${term}%`);
  }

  const { data, error } = await query
    .order("promised_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TicketWithRelations[];
}

export async function getTicket(id: string): Promise<TicketWithRelations | null> {
  const { data } = await supabase.from("repair_tickets").select(TICKET_SELECT).eq("id", id).maybeSingle();
  return (data as unknown as TicketWithRelations) ?? null;
}

export async function getStatusHistory(ticketId: string): Promise<StatusHistoryEntry[]> {
  const { data } = await supabase
    .from("repair_status_history")
    .select("*, staff:staff!repair_status_history_changed_by_fkey (full_name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as StatusHistoryEntry[];
}

export async function getPhotos(ticketId: string): Promise<RepairPhoto[]> {
  const { data } = await supabase
    .from("repair_photos")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  return (data ?? []) as RepairPhoto[];
}

export type CustomerMatch = Customer & { origin: "local" | "inventory" };

/** بحث الزبون: محلياً أولاً (يعمل دائماً)، ثم في المخزون إن كان متاحاً. */
export async function searchCustomers(phone: string): Promise<CustomerMatch[]> {
  const digits = phoneDigits(phone);
  if (digits.length < 3) return [];
  const tail = digits.slice(-6);

  const { data: local } = await supabase
    .from("customers")
    .select("id, inventory_customer_id, full_name, phone, notes")
    .ilike("phone", `%${tail}%`)
    .limit(10);

  const matches: CustomerMatch[] = (local ?? []).map((c) => ({ ...c, origin: "local" as const }));
  const seenInventory = new Set(matches.map((m) => m.inventory_customer_id).filter(Boolean));
  const seenPhones = new Set(matches.map((m) => phoneDigits(m.phone)));

  const remote = await lookupCustomers(digits);
  if (remote.ok) {
    for (const c of remote.data.customers) {
      if (seenInventory.has(c.id)) continue;
      if (c.phone && seenPhones.has(phoneDigits(c.phone))) continue;
      matches.push({
        id: `inventory:${c.id}`,
        inventory_customer_id: c.id,
        full_name: c.full_name,
        phone: c.phone ?? "",
        notes: null,
        origin: "inventory",
      });
    }
  }

  return matches;
}

/** يُرجع معرّف زبون محلي جاهز للربط، منشئاً إياه عند الحاجة. */
export async function resolveCustomer(input: {
  customerId?: string | null;
  fullName: string;
  phone: string;
}): Promise<string> {
  const { customerId, fullName, phone } = input;
  if (customerId && !customerId.startsWith("inventory:")) return customerId;

  const inventoryId = customerId?.startsWith("inventory:") ? customerId.slice("inventory:".length) : null;

  if (inventoryId) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("inventory_customer_id", inventoryId)
      .maybeSingle();
    if (existing) return existing.id;

    const { data: created, error } = await supabase
      .from("customers")
      .insert({ inventory_customer_id: inventoryId, full_name: fullName, phone })
      .select("id")
      .single();
    if (error || !created) throw new Error("تعذّر حفظ بيانات الزبون");
    return created.id;
  }

  // زبون جديد — نحاول تسجيله في المخزون أيضاً، وفشل ذلك لا يمنع فتح التذكرة.
  const remote = await createInventoryCustomer({ full_name: fullName, phone });

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      full_name: fullName,
      phone,
      inventory_customer_id: remote.ok ? remote.data.customer.id : null,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error("تعذّر حفظ بيانات الزبون");
  return created.id;
}

export type CreateTicketInput = {
  customer_id: string;
  branch_id: string;
  received_by: string;
  item_source: "inventory" | "manual";
  inventory_product_id: string | null;
  item_code: string | null;
  item_name: string;
  item_type: string | null;
  karat: string | null;
  weight_in_grams: number | null;
  problem_description: string;
  estimated_cost: number | null;
  promised_at: string | null;
};

export async function createTicket(input: CreateTicketInput): Promise<TicketWithRelations> {
  const { data: ticketNumber, error: numberError } = await supabase.rpc("next_ticket_number", {
    p_branch_id: input.branch_id,
  });
  if (numberError) throw new Error(`تعذّر توليد رقم التذكرة: ${numberError.message}`);

  const { data, error } = await supabase
    .from("repair_tickets")
    .insert({ ...input, ticket_number: ticketNumber as string, status: "received" })
    .select(TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);

  const ticket = data as unknown as TicketWithRelations;

  await supabase.from("repair_status_history").insert({
    ticket_id: ticket.id,
    from_status: null,
    to_status: "received",
    note: "فتح التذكرة",
    changed_by: input.received_by,
  });

  // نموذج الاستلام لم يعد يربط بقطعة من المخزون (أُلغي حقل الباركود)، لكن
  // الحقل باقٍ في المخطط فنحترمه إن وُجد في تذكرة قديمة أو ربط لاحق.
  if (input.inventory_product_id) void setItemStatus(input.inventory_product_id, "in_repair");
  void syncTickets({ ticketIds: [ticket.id] });

  return ticket;
}

export type WeightCheck = { tolerance: number; difference: number; withinTolerance: boolean };

export function checkWeight(weightIn: number, weightOut: number, tolerance: number): WeightCheck {
  const difference = Number((weightOut - weightIn).toFixed(3));
  return { tolerance, difference, withinTolerance: Math.abs(difference) <= tolerance };
}

export type TransitionInput = {
  ticketId: string;
  to: RepairStatus;
  staffId: string;
  tolerance: number;
  note?: string | null;
  workDone?: string | null;
  finalCost?: number | null;
  weightOut?: number | null;
  deliveredToName?: string | null;
  varianceNote?: string | null;
  acceptVariance?: boolean;
};

export type TransitionResult = { ok: true } | { ok: false; error: string; weightCheck?: WeightCheck };

export async function transitionTicket(input: TransitionInput): Promise<TransitionResult> {
  const ticket = await getTicket(input.ticketId);
  if (!ticket) return { ok: false, error: "التذكرة غير موجودة" };

  if (!ALLOWED_TRANSITIONS[ticket.status].includes(input.to)) {
    return { ok: false, error: "انتقال غير مسموح من الحالة الحالية" };
  }

  const update: Record<string, unknown> = { status: input.to };
  if (input.workDone !== undefined) update.work_done = input.workDone;
  if (input.finalCost !== undefined) update.final_cost = input.finalCost;

  if (input.to === "delivered") {
    // التسليم هو اللحظة التي يجب أن تُوزن فيها القطعة؛ لا تجاوز لفرق الوزن إلا
    // بقرار صريح من الموظف مع سبب مكتوب.
    if (ticket.weight_in_grams !== null) {
      if (input.weightOut === null || input.weightOut === undefined) {
        return { ok: false, error: "أدخل وزن القطعة عند التسليم" };
      }

      const check = checkWeight(ticket.weight_in_grams, input.weightOut, input.tolerance);
      if (!check.withinTolerance && !input.acceptVariance) {
        return { ok: false, error: "فرق الوزن يتجاوز المسموح", weightCheck: check };
      }
      if (!check.withinTolerance) {
        update.weight_variance_accepted_by = input.staffId;
        update.weight_variance_note = input.varianceNote ?? null;
      }
    }

    if (input.weightOut !== undefined && input.weightOut !== null) {
      update.weight_out_grams = input.weightOut;
      update.weight_checked_at = new Date().toISOString();
    }
    update.delivered_to_name = input.deliveredToName ?? ticket.customer?.full_name ?? null;
  }

  const { error } = await supabase.from("repair_tickets").update(update).eq("id", input.ticketId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("repair_status_history").insert({
    ticket_id: input.ticketId,
    from_status: ticket.status,
    to_status: input.to,
    note: input.note ?? null,
    changed_by: input.staffId,
  });

  if (ticket.inventory_product_id && (input.to === "delivered" || input.to === "cancelled")) {
    void setItemStatus(ticket.inventory_product_id, "sold");
  }
  void syncTickets({ ticketIds: [input.ticketId] });

  return { ok: true };
}

export type DashboardStats = {
  open: number;
  overdue: number;
  ready: number;
  inProgress: number;
  deliveredToday: number;
};

export async function getDashboardStats(branchId?: string): Promise<DashboardStats> {
  const base = () => {
    const q = supabase.from("repair_tickets").select("id", { count: "exact", head: true });
    return branchId ? q.eq("branch_id", branchId) : q;
  };
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [open, overdue, ready, inProgress, deliveredToday] = await Promise.all([
    base().in("status", OPEN_STATUSES),
    base().in("status", OPEN_STATUSES).lt("promised_at", new Date().toISOString()),
    base().eq("status", "ready"),
    base().eq("status", "in_progress"),
    base().eq("status", "delivered").gte("delivered_at", startOfToday.toISOString()),
  ]);

  return {
    open: open.count ?? 0,
    overdue: overdue.count ?? 0,
    ready: ready.count ?? 0,
    inProgress: inProgress.count ?? 0,
    deliveredToday: deliveredToday.count ?? 0,
  };
}

const DEFAULT_SETTINGS = {
  weight_tolerance_grams: "0.05",
  default_turnaround_days: "3",
  pickup_reminder_days: "3",
  shop_name: "مجوهرات",
  receipt_footer: "يرجى الاحتفاظ بهذا الإيصال لاستلام القطعة",
};

export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const { data } = await supabase.from("settings").select("key, value");
  const out = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    if (row.key in out) out[row.key as keyof Settings] = row.value;
  }
  return out;
}

export function toleranceFrom(settings: Settings): number {
  const parsed = Number(settings.weight_tolerance_grams);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.05;
}
