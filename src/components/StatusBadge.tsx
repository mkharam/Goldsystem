import { REPAIR_STATUS } from "@/lib/constants";
import type { RepairStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: RepairStatus }) {
  const meta = REPAIR_STATUS[status];
  return (
    <span className={`badge ${meta.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
