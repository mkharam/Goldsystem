import { useState } from "react";
import type { TicketWithRelations } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * إجراء واتساب للتذكرة الجاهزة: «أبلغ» إن لم يُبلَّغ الزبون بعد جاهزيتها، «ذكّر» إن مرّت
 * أيام التذكير على الجاهزية وعلى آخر إشعار دون تسليم، وإلا نُظهر فقط أنه أُبلغ.
 */
export function ReadyAction({
  ticket, lastNotifiedAt, reminderDays, onSend,
}: {
  ticket: TicketWithRelations;
  lastNotifiedAt: string | null;
  reminderDays: number;
  onSend: (kind: "ready" | "reminder") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (!ticket.customer?.phone) return null;

  const readyAt = new Date(ticket.ready_at ?? ticket.received_at).getTime();
  const notifiedAt = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : null;
  const notifiedSinceReady = notifiedAt !== null && notifiedAt >= readyAt;
  const dueForReminder =
    notifiedSinceReady &&
    Date.now() - readyAt >= reminderDays * DAY_MS &&
    Date.now() - (notifiedAt as number) >= reminderDays * DAY_MS;

  if (notifiedSinceReady && !dueForReminder) {
    return <p className="mb-2 mt-1 text-center text-xs text-slate-400">✓ أُبلغ الزبون</p>;
  }
  const kind = notifiedSinceReady ? "reminder" : "ready";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => { setBusy(true); await onSend(kind); setBusy(false); }}
      className="btn-success mb-2 mt-1 w-full py-2 text-sm"
    >
      {kind === "ready" ? "أبلغ الزبون عبر واتساب" : "ذكّر الزبون بالاستلام"}
    </button>
  );
}

/** هل هذه التذكرة تحتاج تبليغاً الآن (لم تُبلَّغ بعد، أو حان وقت التذكير)؟ */
export function needsNotification(
  ticket: TicketWithRelations,
  lastNotifiedAt: string | null,
  reminderDays: number,
): boolean {
  if (!ticket.customer?.phone) return false;
  const readyAt = new Date(ticket.ready_at ?? ticket.received_at).getTime();
  const notifiedAt = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : null;
  const notifiedSinceReady = notifiedAt !== null && notifiedAt >= readyAt;
  if (!notifiedSinceReady) return true;
  const dueForReminder =
    Date.now() - readyAt >= reminderDays * DAY_MS &&
    Date.now() - (notifiedAt as number) >= reminderDays * DAY_MS;
  return dueForReminder;
}
