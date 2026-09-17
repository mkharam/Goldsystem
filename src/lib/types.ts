export type RepairStatus = "received" | "in_progress" | "ready" | "delivered" | "cancelled";
export type ItemSource = "inventory" | "manual";
export type PhotoStage = "intake" | "progress" | "delivery";
export type StaffRole = "admin" | "manager" | "employee";

export type Branch = {
  id: string;
  inventory_branch_id: string | null;
  name: string;
  code: string | null;
  phone: string | null;
  is_active: boolean;
};

export type Staff = {
  id: string;
  inventory_staff_id: string | null;
  email: string;
  full_name: string;
  role: StaffRole;
  branch_id: string | null;
  is_active: boolean;
};

export type Customer = {
  id: string;
  inventory_customer_id: string | null;
  full_name: string;
  phone: string;
  notes: string | null;
};

export type RepairTicket = {
  id: string;
  ticket_number: string;
  customer_id: string;
  branch_id: string;
  received_by: string | null;
  assigned_to: string | null;
  item_source: ItemSource;
  inventory_product_id: string | null;
  item_code: string | null;
  item_name: string;
  item_type: string | null;
  karat: string | null;
  weight_in_grams: number | null;
  weight_out_grams: number | null;
  weight_checked_at: string | null;
  weight_variance_accepted_by: string | null;
  weight_variance_note: string | null;
  problem_description: string;
  work_done: string | null;
  estimated_cost: number | null;
  final_cost: number | null;
  status: RepairStatus;
  received_at: string;
  promised_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  delivered_to_name: string | null;
  tracking_token: string;
  created_at: string;
  updated_at: string;
};

export type RepairPhoto = {
  id: string;
  ticket_id: string;
  storage_path: string;
  stage: PhotoStage;
  caption: string | null;
  is_public: boolean;
  created_at: string;
};

export type StatusHistoryEntry = {
  id: string;
  ticket_id: string;
  from_status: RepairStatus | null;
  to_status: RepairStatus;
  note: string | null;
  changed_by: string | null;
  created_at: string;
  staff?: { full_name: string } | null;
};

/** تذكرة مع علاقاتها كما تُعرض في القوائم وصفحة التفاصيل. */
export type TicketWithRelations = RepairTicket & {
  customer: Pick<Customer, "id" | "full_name" | "phone"> | null;
  branch: Pick<Branch, "id" | "name" | "code" | "phone"> | null;
  received_by_staff: { full_name: string } | null;
  assigned_to_staff: { full_name: string } | null;
};

/** نتيجة بحث القطعة في المخزون — تُستخدم لتعبئة نموذج الاستلام. */
export type InventoryItem = {
  source: "product" | "sale";
  product_id: string | null;
  sku: string | null;
  name: string | null;
  item_type: string | null;
  karat: string | null;
  weight_grams: number | null;
  ring_size: string | null;
  branch_id: string | null;
  status: string | null;
  sale: {
    sale_id: string;
    sold_at: string;
    customer_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
  } | null;
};

export type SessionStaff = {
  staff_id: string;
  full_name: string;
  role: StaffRole;
  branch_id: string | null;
};
