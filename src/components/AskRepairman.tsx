import { useToast } from "@/lib/toast";
import { askRepairman, REPAIRMAN_PHONE } from "@/lib/whatsapp";
import type { TicketWithRelations } from "@/lib/types";

/** زر «اسأل الفني عن القطعة»: يفتح واتساب مع الفني برسالة جاهزة فيها بيانات القطعة. */
export function AskRepairman({
  ticket, phone = REPAIRMAN_PHONE, compact,
}: {
  ticket: TicketWithRelations;
  phone?: string;
  compact?: boolean;
}) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => { if (!askRepairman(ticket, phone)) toast("رقم الفني غير صالح", "error"); }}
      className={
        compact
          ? "mb-2 mt-1 w-full rounded-lg border border-slate-300 bg-white py-2 text-sm font-medium text-slate-700 transition hover:border-brand-300 active:scale-[0.98]"
          : "btn-ghost w-full"
      }
    >
      اسأل الفني عن القطعة (واتساب)
    </button>
  );
}
