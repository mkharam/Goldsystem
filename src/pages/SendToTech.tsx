import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BranchPicker, useBranches } from "@/components/BranchPicker";
import { useAuth } from "@/lib/auth";
import { getSettings, listTickets } from "@/lib/tickets";
import { supabase } from "@/lib/supabase";
import { buildTechListMessage, openRepairmanChat, REPAIRMAN_PHONE } from "@/lib/whatsapp";
import { formatWeight, formatDateTime } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { TicketWithRelations } from "@/lib/types";

/**
 * إرسال قائمة القطع للفني قبل أن يأتي: القطع المستلمة التي لم تُسلَّم له بعد، بالعمل المطلوب
 * لكل قطعة ورابط صفحة صورها. على الهاتف تُرفق الصور نفسها عبر قائمة المشاركة (يختار واتساب)،
 * وعلى الحاسوب تُفتح محادثة الفني بالنص والروابط. المرسَل يُعلَّم «أُرسلت للفني» حتى لا يتكرر.
 */
export default function SendToTech() {
  const { staff } = useAuth();
  const toast = useToast();
  const branches = useBranches();
  const [branch, setBranch] = useState<string | "all">(staff?.branch_id ?? "all");
  const [tickets, setTickets] = useState<TicketWithRelations[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSent, setShowSent] = useState(false);
  const [phone, setPhone] = useState(REPAIRMAN_PHONE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const branchId = branch === "all" ? undefined : branch;

  const load = async () => {
    setLoading(true);
    const [rows, settings] = await Promise.all([
      listTickets({ status: "received", branchId, newest: false, limit: 200 }),
      getSettings(),
    ]);
    setPhone(settings.repairman_phone || REPAIRMAN_PHONE);
    setTickets(rows);
    // افتراضياً: كل ما لم يُرسل بعد محدد.
    setSelected(new Set(rows.filter((t) => !t.sent_to_tech_at).map((t) => t.id)));
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branch]);

  const { pending, sent } = useMemo(() => ({
    pending: tickets.filter((t) => !t.sent_to_tech_at),
    sent: tickets.filter((t) => t.sent_to_tech_at),
  }), [tickets]);
  const shown = showSent ? tickets : pending;
  const chosen = tickets.filter((t) => selected.has(t.id));

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const markSent = async () => {
    await supabase.rpc("mark_sent_to_tech", { p_ids: chosen.map((t) => t.id) });
    void load();
  };

  const branchName = branchId ? branches.find((b) => b.id === branchId)?.name : undefined;

  // الهاتف: الصور نفسها + النص عبر المشاركة (واتساب يرسلها كألبوم والنص معها).
  async function shareWithPhotos() {
    if (!chosen.length) return;
    setBusy(true);
    const text = buildTechListMessage(chosen, branchName);
    try {
      const files: File[] = [];
      for (const [i, t] of chosen.entries()) {
        if (!t.photo_url) continue;
        const blob = await fetch(t.photo_url).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
        if (blob) files.push(new File([blob], `${i + 1}-${t.ticket_number}.jpg`, { type: blob.type || "image/jpeg" }));
      }
      if (files.length && navigator.canShare?.({ files, text })) {
        // النص يُنسخ أيضاً: بعض نسخ واتساب تأخذ الصور وتُسقط النص المرافق.
        await navigator.clipboard?.writeText(text).catch(() => {});
        await navigator.share({ files, text });
        toast("اختر محادثة الفني في واتساب — النص منسوخ أيضاً لو احتجت لصقه");
        await markSent();
      } else {
        openRepairmanChat(text, phone);
        await markSent();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("تعذّرت المشاركة — جرّب «نص وروابط»", "error");
    }
    setBusy(false);
  }

  async function sendText() {
    if (!chosen.length) return;
    if (!openRepairmanChat(buildTechListMessage(chosen, branchName), phone)) return toast("رقم الفني غير صالح", "error");
    await markSent();
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-bold text-slate-900">إرسال القطع للفني</h1>
      <p className="mb-3 text-sm text-slate-500">القطع المستلمة التي تحتاج الفني — يعرف ما عنده قبل أن يأتي للمحل.</p>

      {staff?.role === "admin" && <BranchPicker branches={branches} value={branch} onChange={setBranch} />}

      <div className="mb-3 flex items-center gap-2 text-sm">
        <button onClick={() => setShowSent(false)} className={`rounded-full border px-3 py-1.5 ${!showSent ? "border-brand-700 bg-brand-700 text-white" : "bg-white"}`}>
          لم تُرسل ({pending.length})
        </button>
        <button onClick={() => setShowSent(true)} className={`rounded-full border px-3 py-1.5 ${showSent ? "border-brand-700 bg-brand-700 text-white" : "bg-white"}`}>
          الكل ({tickets.length})
        </button>
        <span className="flex-1" />
        <button onClick={() => setSelected(new Set(shown.map((t) => t.id)))} className="text-xs text-brand-700">تحديد الكل</button>
        <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500">إلغاء</button>
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="card h-20 animate-pulse bg-slate-100" />)}</div>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">{sent.length ? "كل القطع أُرسلت للفني ✓" : "لا توجد قطع مستلمة"}</p>
      ) : (
        <div className="space-y-2 pb-40">
          {shown.map((t) => (
            <label key={t.id} className={`card flex cursor-pointer items-center gap-3 p-3 ${selected.has(t.id) ? "border-gold-400 bg-gold-50/50" : ""}`}>
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="size-5 accent-brand-700" />
              {t.photo_url ? <img src={t.photo_url} alt="" className="size-14 rounded-lg border object-cover" /> : <div className="size-14 rounded-lg bg-slate-100" />}
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">{t.item_name} <span className="text-xs font-normal text-slate-400">{t.ticket_number}</span></p>
                <p className="truncate text-sm text-slate-600">{t.problem_description}</p>
                <p className="text-xs text-slate-400">
                  {[t.karat, t.weight_in_grams !== null ? formatWeight(t.weight_in_grams) : null].filter(Boolean).join(" · ")}
                  {t.sent_to_tech_at && <span className="text-brand-700"> · أُرسلت للفني {formatDateTime(t.sent_to_tech_at)}</span>}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[84px] z-30 mx-auto max-w-3xl px-3">
        <div className="card flex gap-2 p-2 shadow-lg">
          <button onClick={() => void shareWithPhotos()} disabled={!chosen.length || busy} className="btn-primary flex-1">
            {busy ? "جارٍ التجهيز…" : `إرسال مع الصور (${chosen.length})`}
          </button>
          <button onClick={() => void sendText()} disabled={!chosen.length || busy} className="btn-ghost">نص وروابط</button>
        </div>
      </div>
    </AppShell>
  );
}
