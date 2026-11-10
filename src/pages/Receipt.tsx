import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getTicket, getSettings, getPhotos, updateTicketDetails, type Settings } from "@/lib/tickets";
import { signedPhotoUrls } from "@/lib/supabase";
import { uploadTicketPhoto } from "@/lib/photos";
import { useAuth } from "@/lib/auth";
import { OPEN_STATUSES, normalizeDigits } from "@/lib/constants";
import { formatDateTime, formatWeight, formatMoney } from "@/lib/format";
import { qrSvg, trackingUrl } from "@/lib/qr";
import { Logo } from "@/components/Logo";
import type { TicketWithRelations, RepairPhoto } from "@/lib/types";

/**
 * إيصال فاخر كل مقاساته نسبية لعرضه (راجع ‎.a5-wrap في index.css): على الشاشة بعرض الهاتف،
 * وعند الطباعة يملأ عرض الورقة (A5 أو A4) من آيفون أو لابتوب في صفحة واحدة.
 *
 * يطبع تذكرة واحدة (/tickets/:id/receipt)، أو إيصالاً واحداً مجمّعاً لعدة قطع لنفس الزبون
 * (/receipts?ids=a,b,c): بياناته مرة واحدة، وجدول بالقطع (صورة، اسم، وزن، مطلوب، سعر)،
 * ورمز متابعة صغير لكل قطعة.
 */
export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const ids = id ? [id] : (params.get("ids") ?? "").split(",").filter(Boolean);
  const [settings, setSettings] = useState<Settings | null>(null);
  // عدة قطع: فاتورة واحدة كاملة بصور القطع وتفاصيلها (الافتراضي)، ويمكن إضافة تذكرة مستقلة لكل قطعة بعدها.
  const [perTicket, setPerTicket] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const waitImages = async () => {
    const pending = Array.from(document.images).filter((img) => !img.complete);
    await Promise.all(pending.map((img) => new Promise((resolve) => { img.onload = img.onerror = resolve; })));
  };

  // لا نطبع قبل اكتمال تحميل كل الصور، وإلا خرج الإيصال بمربع فارغ.
  async function print() {
    await waitImages();
    window.print();
  }

  if (!settings || ids.length === 0) {
    return <div className="p-8 text-center text-slate-400">جارٍ التحميل…</div>;
  }

  return (
    <div className="py-4 print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[446px] gap-2 px-3">
        <Link to={ids.length === 1 ? `/tickets/${ids[0]}` : "/"} className="btn-ghost flex-1">
          {ids.length === 1 ? "التذكرة" : "الرئيسية"}
        </Link>
        <button type="button" onClick={print} className="btn-primary flex-1">طباعة</button>
      </div>

      {ids.length > 1 && (
        <label className="no-print mx-auto mb-4 flex max-w-[446px] items-center gap-2 px-4 text-sm text-slate-600">
          <input type="checkbox" checked={perTicket} onChange={(e) => setPerTicket(e.target.checked)} />
          أضف تذكرة مستقلة لكل قطعة بعد الفاتورة
        </label>
      )}

      {ids.length === 1
        ? <ReceiptSheet id={ids[0]} settings={settings} />
        : (
          <>
            <CombinedSheet ids={ids} settings={settings} />
            {perTicket && ids.map((tid) => (
              <div key={tid} className="receipt-page-break mt-6 print:mt-0">
                <ReceiptSheet id={tid} settings={settings} />
              </div>
            ))}
          </>
        )}
    </div>
  );
}

function ReceiptSheet({ id, settings }: { id: string; settings: Settings }) {
  const [ticket, setTicket] = useState<TicketWithRelations | null>(null);
  const [qr, setQr] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [t, photos] = await Promise.all([getTicket(id), getPhotos(id)]);
      setTicket(t);
      // صورة القطعة عند الاستلام تحمي المحل والزبون معاً: شكلها كما سُلّمت، مطبوعاً على الإيصال.
      const first = photos.find((p) => p.stage === "intake") ?? photos[0];
      if (first) {
        const urls = await signedPhotoUrls([first.storage_path]);
        setPhoto(urls[first.storage_path] ?? null);
      }
      if (t) setQr(await qrSvg(trackingUrl(t.tracking_token), 150));
    })();
  }, [id]);

  if (!ticket) {
    return <div className="a5-wrap h-40 animate-pulse rounded-lg bg-slate-100 no-print" />;
  }

  return (
    <div className="a5-wrap">
    <div className="a5-sheet">
      {(["tr", "tl", "br", "bl"] as const).map((c) => <Corner key={c} className={c} />)}

      <header className="a5-band">
        <Logo size={56} className="a5-logo" />
        <h1 className="a5-shop">{settings.shop_name}</h1>
        <p className="a5-ornament">إيصال استلام صيانة</p>
      </header>

      <div className="a5-medal">
        <small>رقم الإيصال</small>
        <b dir="ltr">{ticket.ticket_number}</b>
      </div>

      <div className="a5-body">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" className="a5-watermark" />

        <div className="relative min-w-0">
          <p className="a5-title">بيانات القطعة</p>
          <dl className="a5-details">
            <Row label="الزبون" value={ticket.customer?.full_name ?? "—"} />
            <Row label="القطعة" value={ticket.item_name} />
            {ticket.karat && <Row label="العيار" value={ticket.karat} />}
            {ticket.weight_in_grams !== null && <Row label="الوزن" value={formatWeight(ticket.weight_in_grams)} />}
            <Row label="العطل" value={ticket.problem_description} clamp />
            {/* تاريخ الاستلام لا موعد الجاهزية: الموعد تقديري، وطباعته تجعل الزبون يأتي
                فيه ولو لم تجهز القطعة. الموعد التقديري وحالة القطعة في صفحة المتابعة (QR). */}
            <Row label="تاريخ الاستلام" value={formatDateTime(ticket.received_at)} />
            {ticket.branch?.name && <Row label="الفرع" value={ticket.branch.name} />}
          </dl>
          {ticket.estimated_cost !== null && (
            <div className="a5-price">
              <span>السعر التقريبي</span>
              <b>{formatMoney(ticket.estimated_cost)}</b>
            </div>
          )}
        </div>

        <aside className="a5-side">
          {photo && (
            <>
              <div className="a5-frame">
                <div className="a5-photo">
                  <PrintableImg src={photo} alt="صورة القطعة" />
                </div>
              </div>
              <p className="a5-caption">صورة القطعة عند الاستلام</p>
            </>
          )}
          {/* الزبون يتابع حالة قطعته بمسح الرمز — بلا تطبيق ولا تسجيل دخول. */}
          <div className="a5-frame">
            <div className="a5-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          </div>
          <p className="a5-caption">امسح الرمز لمتابعة<br />حالة قطعتك</p>
        </aside>
      </div>

      <footer className="a5-foot">
        <p>{settings.receipt_footer}</p>
      </footer>
    </div>
    </div>
  );
}

/** قطعة في الفاتورة المجمّعة: بياناتها وكل صورها وأيّها تُطبع (chosen). */
type Piece = {
  ticket: TicketWithRelations;
  photos: RepairPhoto[];
  urls: Record<string, string>;
  chosen: string | null;
};

const defaultPhotoId = (photos: RepairPhoto[]) => (photos.find((p) => p.stage === "intake") ?? photos[0])?.id ?? null;

/**
 * إيصال واحد لكل قطع الزبون — بطاقة فاخرة لا فاتورة: بيانات الزبون مع رمز QR واحد
 * (يفتح صفحة متابعة تعرض كل قطع هذه الزيارة)، ثم القطع كصفوف أنيقة بصورها، ثم الإجمالي.
 */
function CombinedSheet({ ids, settings }: { ids: string[]; settings: Settings }) {
  const { staff } = useAuth();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [qr, setQr] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const loaded = await Promise.all(ids.map(async (id) => {
        const [ticket, photos] = await Promise.all([getTicket(id), getPhotos(id)]);
        return { ticket, photos };
      }));
      const valid = loaded.filter((x): x is { ticket: TicketWithRelations; photos: RepairPhoto[] } => !!x.ticket);
      const paths = valid.flatMap((x) => x.photos.flatMap((p) => (p.thumb_path ? [p.storage_path, p.thumb_path] : [p.storage_path])));
      const urls = await signedPhotoUrls(paths);
      const out: Piece[] = valid.map(({ ticket, photos }) => ({ ticket, photos, urls, chosen: defaultPhotoId(photos) }));
      // بترتيب رقم التذكرة — نفس ترتيب إدخالها.
      out.sort((a, b) => a.ticket.ticket_number.localeCompare(b.ticket.ticket_number, undefined, { numeric: true }));
      setPieces(out);
      if (out[0]) setQr(await qrSvg(trackingUrl(out[0].ticket.tracking_token), 150));
    })();
  }, [ids.join(",")]);

  const updatePiece = (id: string, patch: Partial<Piece>) =>
    setPieces((list) => (list ? list.map((p) => (p.ticket.id === id ? { ...p, ...patch } : p)) : list));

  if (!pieces) return <div className="a5-wrap h-40 animate-pulse rounded-lg bg-slate-100 no-print" />;
  if (!pieces.length) return <div className="p-8 text-center text-slate-400">لا توجد تذاكر</div>;

  const first = pieces[0].ticket;
  const priced = pieces.filter((p) => p.ticket.estimated_cost !== null);
  const total = priced.reduce((sum, p) => sum + (p.ticket.estimated_cost ?? 0), 0);
  const totalWeight = pieces.reduce((sum, p) => sum + (p.ticket.weight_in_grams ?? 0), 0);

  return (
    <div className="a5-wrap">
    <div className="a5-sheet a5-multi">
      {(["tr", "tl", "br", "bl"] as const).map((c) => <Corner key={c} className={c} />)}

      <header className="a5-band">
        <Logo size={56} className="a5-logo" />
        <h1 className="a5-shop">{settings.shop_name}</h1>
        <p className="a5-ornament">إيصال استلام صيانة</p>
      </header>

      <div className="a5-medal">
        <small>{pieces.length} قطع</small>
        <b dir="ltr">{first.ticket_number}</b>
      </div>

      <div className="a5-body">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" className="a5-watermark" />

        <div className="relative min-w-0">
          <p className="a5-title">بيانات الزبون</p>
          <dl className="a5-details">
            <Row label="الاسم" value={first.customer?.full_name ?? "—"} />
            <Row label="تاريخ الاستلام" value={formatDateTime(first.received_at)} />
            {first.branch?.name && <Row label="الفرع" value={first.branch.name} />}
          </dl>
        </div>

        {/* رمز واحد لكل القطع: صفحة المتابعة تعرض قطع هذه الزيارة كلها. */}
        <aside className="a5-side">
          <div className="a5-frame">
            <div className="a5-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          </div>
          <p className="a5-caption">امسح الرمز لمتابعة<br />كل قطعك</p>
        </aside>
      </div>

      <div className="a5-pieces">
        <p className="a5-title">القطع</p>
        {pieces.map((piece, i) => {
          const { ticket: t } = piece;
          const chosenPhoto = piece.photos.find((p) => p.id === piece.chosen);
          const photo = chosenPhoto ? piece.urls[chosenPhoto.storage_path] ?? null : null;
          return (
          <div key={t.id}>
          <div className="a5-piece">
            <div className="a5-piece-photo">
              {photo ? <PrintableImg src={photo} alt="" /> : <Logo size={40} className="a5-piece-logo" />}
              <span className="a5-piece-num">{i + 1}</span>
              <button
                type="button"
                onClick={() => setEditing(editing === t.id ? null : t.id)}
                className="no-print absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-gold-500 bg-white px-2 py-0.5 text-[10px] font-bold text-brand-800 shadow"
              >
                {editing === t.id ? "إغلاق" : "تعديل"}
              </button>
            </div>
            <div className="a5-piece-body">
              <p className="a5-piece-name">{t.item_name}</p>
              <p className="a5-piece-meta">
                {[t.karat, t.weight_in_grams !== null ? formatWeight(t.weight_in_grams) : null].filter(Boolean).join("  ·  ")}
              </p>
              <p className="a5-piece-work a5-clamp">{t.problem_description}</p>
            </div>
            <div className="a5-piece-price">
              <b>{t.estimated_cost !== null ? formatMoney(t.estimated_cost) : "لاحقاً"}</b>
              <span dir="ltr">{t.ticket_number}</span>
            </div>
          </div>
          {editing === t.id && staff && (
            <PieceEditor
              piece={piece}
              staffId={staff.staff_id}
              onPiece={(patch) => updatePiece(t.id, patch)}
              onClose={() => setEditing(null)}
            />
          )}
          </div>
          );
        })}

        <div className="a5-price a5-total">
          <span>
            الإجمالي التقريبي
            {totalWeight > 0 && <small> · الوزن {formatWeight(totalWeight)}</small>}
            {priced.length < pieces.length && <small> · بعض الأسعار تُحدَّد لاحقاً</small>}
          </span>
          <b>{priced.length ? formatMoney(total) : "لاحقاً"}</b>
        </div>
      </div>

      <footer className="a5-foot">
        <p>{settings.receipt_footer}</p>
      </footer>
    </div>
    </div>
  );
}

/**
 * تعديل قطعة داخل الفاتورة قبل الطباعة (لا يُطبع): اختيار أي صورة تظهر، أو إضافة صورة جديدة،
 * وتصحيح الاسم والعمل المطلوب والسعر. التعديل يُحفظ في التذكرة نفسها ويُسجَّل في سجلّها.
 */
function PieceEditor({
  piece, staffId, onPiece, onClose,
}: {
  piece: Piece;
  staffId: string;
  onPiece: (patch: Partial<Piece>) => void;
  onClose: () => void;
}) {
  const t = piece.ticket;
  const editable = OPEN_STATUSES.includes(t.status);
  const [name, setName] = useState(t.item_name);
  const [work, setWork] = useState(t.problem_description);
  const [cost, setCost] = useState(t.estimated_cost !== null ? String(t.estimated_cost) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const photo = await uploadTicketPhoto(t.id, file, staffId, "intake");
    if (!photo) {
      setMsg("تعذّر رفع الصورة");
    } else {
      const urls = await signedPhotoUrls([photo.storage_path, ...(photo.thumb_path ? [photo.thumb_path] : [])]);
      onPiece({ photos: [...piece.photos, photo], urls: { ...piece.urls, ...urls }, chosen: photo.id });
    }
    setBusy(false);
  }

  async function save() {
    if (!name.trim() || !work.trim()) return setMsg("الاسم والعمل المطلوب لا يمكن أن يكونا فارغين");
    setBusy(true);
    setMsg(null);
    const result = await updateTicketDetails(t.id, staffId, {
      item_name: name.trim(),
      problem_description: work.trim(),
      estimated_cost: cost.trim() ? Number(normalizeDigits(cost)) : null,
    });
    if (!result.ok) {
      setMsg(result.error);
    } else {
      const fresh = await getTicket(t.id);
      if (fresh) onPiece({ ticket: fresh });
      setMsg(result.changed ? "تم الحفظ" : "لا يوجد تغيير");
    }
    setBusy(false);
  }

  return (
    <div className="no-print my-2 space-y-3 rounded-xl border border-gold-300 bg-gold-50 p-3 text-sm" dir="rtl">
      <div>
        <p className="mb-1.5 font-semibold text-slate-700">الصورة المطبوعة</p>
        <div className="flex flex-wrap gap-2">
          {piece.photos.map((p) => {
            const src = piece.urls[p.thumb_path ?? p.storage_path];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPiece({ chosen: p.id })}
                className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${piece.chosen === p.id ? "border-brand-700" : "border-slate-200"}`}
              >
                {src && <img src={src} alt="" className="h-full w-full object-cover" />}
              </button>
            );
          })}
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-center text-[11px] text-slate-500">
            {busy ? "…" : "+ صورة"}
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy || !editable}
              onChange={(e) => { void addPhoto(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {piece.photos.length === 0 && <p className="mt-1 text-xs text-slate-500">لا توجد صورة لهذه القطعة — أضف واحدة لتظهر في الفاتورة.</p>}
      </div>

      {editable ? (
        <div className="space-y-2">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم القطعة" aria-label="اسم القطعة" />
          <textarea className="field" rows={2} value={work} onChange={(e) => setWork(e.target.value)} placeholder="العمل المطلوب" aria-label="العمل المطلوب" />
          <input className="field text-left" dir="ltr" inputMode="decimal" value={cost}
            onChange={(e) => setCost(normalizeDigits(e.target.value))} placeholder="السعر التقريبي" aria-label="السعر التقريبي" />
        </div>
      ) : (
        <p className="text-xs text-slate-500">لا يمكن تعديل بيانات تذكرة مسلّمة أو ملغاة — الصورة فقط.</p>
      )}

      {msg && <p className="text-xs font-medium text-brand-800">{msg}</p>}
      <div className="flex gap-2">
        {editable && <button type="button" onClick={save} disabled={busy} className="btn-success flex-1 py-2">حفظ التعديل</button>}
        <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2">تم</button>
      </div>
    </div>
  );
}

/** زخرفة ركن ذهبية — تُقلب بالـCSS لتناسب كل ركن. */
function Corner({ className }: { className: string }) {
  return (
    <svg className={`a5-corner ${className}`} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M27 3H9a6 6 0 0 0-6 6v18" stroke="currentColor" strokeWidth="1.4" />
      <path d="M22 7H11a4 4 0 0 0-4 4v11" stroke="currentColor" strokeWidth="0.7" />
      <path d="M3 3l3.2 3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="9" cy="9" r="1.3" fill="currentColor" />
    </svg>
  );
}

function Row({ label, value, ltr, clamp }: { label: string; value: string; ltr?: boolean; clamp?: boolean }) {
  return (
    <div className="a5-row">
      <dt>{label}</dt>
      <dd dir={ltr ? "ltr" : undefined} className={clamp ? "a5-clamp" : undefined}>{value}</dd>
    </div>
  );
}

/**
 * سفاري آيفون لا يطبع الصورة من رابطها الموقّع (أصل آخر، وحجمها كبير) فتخرج فارغة على الورق
 * رغم ظهورها على الشاشة. نحمّلها مرة، ونصغّرها، ونضمّنها في الصفحة كـ data URL فتُطبع دائماً.
 */
function PrintableImg({ src, alt }: { src: string; alt: string }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    (async () => {
      try {
        const res = await fetch(src, { mode: "cors" });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await img.decode();
        const max = 1200;
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        if (alive) setData(c.toDataURL("image/jpeg", 0.88));
      } catch {
        // نبقي الرابط الأصلي إن تعذّر التحويل.
      }
    })();
    return () => { alive = false; };
  }, [src]);
  return <img src={data ?? src} alt={alt} />;
}
