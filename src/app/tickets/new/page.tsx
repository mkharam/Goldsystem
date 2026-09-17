import { requireStaff } from "@/lib/guard";
import { AppShell } from "@/components/AppShell";
import { NewTicketForm } from "./NewTicketForm";
import { db } from "@/lib/db";
import { syncBranches, ensureFallbackBranch } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { inventoryHealth } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const staff = await requireStaff();
  const health = await inventoryHealth();

  // نحاول تحديث الفروع، ونضمن وجود فرع واحد على الأقل حتى قبل أول مزامنة ناجحة.
  if (health === "ok") await syncBranches();
  await ensureFallbackBranch();

  const [{ data: branches }, settings] = await Promise.all([
    db().from("branches").select("id, name, code").eq("is_active", true).order("code"),
    getSettings(),
  ]);

  return (
    <AppShell staff={staff} inventoryStatus={health}>
      <h1 className="mb-4 text-lg font-bold text-slate-900">استلام قطعة للصيانة</h1>
      <NewTicketForm
        branches={branches ?? []}
        defaultBranchId={staff.branch_id}
        turnaroundDays={Number(settings.default_turnaround_days) || 3}
        inventoryAvailable={health === "ok"}
      />
    </AppShell>
  );
}
