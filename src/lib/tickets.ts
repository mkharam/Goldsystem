import "server-only";
import { db } from "./db";
import { OPEN_STATUSES, ALLOWED_TRANSITIONS } from "./constants";
import { getWeightTolerance } from "./settings";
import { setItemStatus } from "./inventory";
import type { RepairStatus, TicketWithRelations, StatusHistoryEntry, RepairPhoto } from "./types";

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
  let query = db().from("repair_tickets").select(TICKET_SELECT);

  if (filters.status === "open") {
    query = query.in("status", OPEN_STATUSES);
  } else if (filters.status === "overdue") {
    query = query.in("status", OPEN_STATUSES).lt("promised_at", new Date().toISOString());
  } else if (filters.status) {
    query = query.eq("status", filters.status);
  }

  if (filters.branchId) query = query.eq("branch_id", filters.branchId);

  if (filters.search?.trim()) {
    const term = filters.search.trim();
    // البحث يغطّي رقم التذكرة وكود القطعة واسمها — ما يعرفه الموظف عادةً.
    query = query.or(`ticket_number.ilike.%${term}%,item_code.ilike.%${term}%,item_name.ilike.%${term}%`);
  }

  // المتأخّرة أولاً ضمن المفتوحة، ثم الأحدث.
  const { data, error } = await query
    .order("promised_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TicketWithRelations[];
}

export async function getTicket(id: string): Promise<TicketWithRelations | null> {
  const { data } = await db().from("repair_tickets").select(TICKET_SELECT).eq("id", id).maybeSingle();
  return (data as unknown as TicketWithRelations) ?? null;
}

export async function getTicketByToken(token: string): Promise<TicketWithRelations | null> {
  const { data } = await db()
    .from("repair_tickets")
    .select(TICKET_SELECT)
    .eq("tracking_token", token)
    .maybeSingle();
  return (data as unknown as TicketWithRelations) ?? null;
}

export async function getStatusHistory(ticketId: string): Promise<StatusHistoryEntry[]> {
  const { data } = await db()
    .from("repair_status_history")
    .select("*, staff:staff!repair_status_history_changed_by_fkey (full_name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as StatusHistoryEntry[];
}

export async function getPhotos(ticketId: string, publicOnly = false): Promise<RepairPhoto[]> {
  let query = db().from("repair_photos").select("*").eq("ticket_id", ticketId);
  if (publicOnly) query = query.eq("is_public", true);
  const { data } = await query.order("created_at", { ascending: true });
  return (data ?? []) as RepairPhoto[];
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
  const { data: numberData, error: numberError } = await db().rpc("next_ticket_number", {
    p_branch_id: input.branch_id,
  });
  if (numberError) throw new Error(`تعذّر توليد رقم التذكرة: ${numberError.message}`);

  const { data, error } = await db()
    .from("repair_tickets")
    .insert({ ...input, ticket_number: numberData as string, status: "received" })
    .select(TICKET_SELECT)
    .single();

  if (error) throw new Error(error.message);
  const ticket = data as unknown as TicketWithRelations;

  await db().from("repair_status_history").insert({
    ticket_id: ticket.id,
    from_status: null,
    to_status: "received",
    note: "فتح التذكرة",
    changed_by: input.received_by,
  });

  // تعليم القطعة "في الصيانة" في المخزون — أثر جانبي مقبول فشله.
  if (input.inventory_product_id) {
    void setItemStatus(input.inventory_product_id, "in_repair");
  }

  return ticket;
}

export type WeightCheck = {
  tolerance: number;
  difference: number;
  withinTolerance: boolean;
};

/** فحص وزن التسليم مقابل وزن الاستلام — الضمانة الأساسية ضد خطأ أو تبديل. */
export async function checkWeight(
  weightIn: number | null,
  weightOut: number | null,
): Promise<WeightCheck | null> {
  if (weightIn === null || weightOut === null) return null;
  const tolerance = await getWeightTolerance();
  const difference = Number((weightOut - weightIn).toFixed(3));
  return { tolerance, difference, withinTolerance: Math.abs(difference) <= tolerance };
}

export type TransitionInput = {
  ticketId: string;
  to: RepairStatus;
  staffId: string;
  note?: string | null;
  workDone?: string | null;
  finalCost?: number | null;
  weightOut?: number | null;
  deliveredToName?: string | null;
  varianceNote?: string | null;
  acceptVariance?: boolean;
};

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string; weightCheck?: WeightCheck };

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
    // التسليم هو اللحظة التي يجب أن يُوزن فيها الشغل. نطلب الوزن متى كان وزن
    // الاستلام معروفاً، ولا نسمح بتجاوز الفرق إلا بقرار صريح من الموظف مع سبب.
    if (ticket.weight_in_grams !== null) {
      if (input.weightOut === null || input.weightOut === undefined) {
        return { ok: false, error: "أدخل وزن القطعة عند التسليم" };
      }

      const check = await checkWeight(ticket.weight_in_grams, input.weightOut);
      if (check && !check.withinTolerance && !input.acceptVariance) {
        return { ok: false, error: "فرق الوزن يتجاوز المسموح", weightCheck: check };
      }

      if (check && !check.withinTolerance) {
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

  const { error } = await db().from("repair_tickets").update(update).eq("id", input.ticketId);
  if (error) return { ok: false, error: error.message };

  await db().from("repair_status_history").insert({
    ticket_id: input.ticketId,
    from_status: ticket.status,
    to_status: input.to,
    note: input.note ?? null,
    changed_by: input.staffId,
  });

  // القطعة تعود لحالتها الطبيعية في المخزون متى خرجت من الصيانة.
  if (ticket.inventory_product_id && (input.to === "delivered" || input.to === "cancelled")) {
    void setItemStatus(ticket.inventory_product_id, "sold");
  }

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
    const q = db().from("repair_tickets").select("id", { count: "exact", head: true });
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
