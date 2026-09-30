import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getTicket, getSettings, getPhotos, type Settings } from "@/lib/tickets";
import { signedPhotoUrls } from "@/lib/supabase";
import { formatDateTime, formatWeight, formatMoney } from "@/lib/format";
import { qrSvg, trackingUrl } from "@/lib/qr";
import { Logo } from "@/components/Logo";
import type { TicketWithRelations } from "@/lib/types";

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

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  // لا نطبع قبل اكتمال تحميل كل الصور، وإلا خرج الإيصال بمربع فارغ.
  async function print() {
    const pending = Array.from(document.images).filter((img) => !img.complete);
    await Promise.all(pending.map((img) => new Promise((resolve) => { img.onload = img.onerror = resolve; })));
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

      {ids.length === 1
        ? <ReceiptSheet id={ids[0]} settings={settings} />
        : <CombinedSheet ids={ids} settings={settings} />}
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
        <span>{formatDateTime(ticket.received_at)}</span>
      </div>

      <div className="a5-body">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" className="a5-watermark" />

        <div className="relative min-w-0">
          <p className="a5-title">بيانات القطعة</p>
          <dl className="a5-details">
            <Row label="الزبون" value={ticket.customer?.full_name ?? "—"} />
            <Row label="الهاتف" value={ticket.customer?.phone ?? "—"} ltr />
            <Row label="القطعة" value={ticket.item_name} />
            {ticket.karat && <Row label="العيار" value={ticket.karat} />}
            {ticket.weight_in_grams !== null && <Row label="الوزن" value={formatWeight(ticket.weight_in_grams)} />}
            <Row label="العطل" value={ticket.problem_description} clamp />
            {ticket.promised_at && <Row label="موعد التسليم" value={formatDateTime(ticket.promised_at)} />}
            {ticket.received_by_staff?.full_name && <Row label="الموظف" value={ticket.received_by_staff.full_name} />}
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
                  <img src={photo} alt="صورة القطعة" />
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

      <div className="a5-signs">
        <div>توقيع الموظف</div>
        <div>توقيع الزبون</div>
      </div>

      <footer className="a5-foot">
        <p>{settings.receipt_footer}</p>
        {ticket.branch?.phone && <p dir="ltr">{ticket.branch.phone}</p>}
      </footer>
    </div>
    </div>
  );
}

type Piece = { ticket: TicketWithRelations; photo: string | null; qr: string };

/** إيصال واحد لكل قطع الزبون. */
function CombinedSheet({ ids, settings }: { ids: string[]; settings: Settings }) {
  const [pieces, setPieces] = useState<Piece[] | null>(null);

  useEffect(() => {
    (async () => {
      const loaded = await Promise.all(ids.map(async (id) => {
        const [ticket, photos] = await Promise.all([getTicket(id), getPhotos(id)]);
        const first = photos.find((p) => p.stage === "intake") ?? photos[0];
        return { ticket, path: first?.storage_path ?? null };
      }));
      const valid: { ticket: TicketWithRelations; path: string | null }[] = [];
      for (const x of loaded) if (x.ticket) valid.push({ ticket: x.ticket, path: x.path });
      const urls = await signedPhotoUrls(valid.map((x) => x.path).filter((p): p is string => !!p));
      const out = await Promise.all(valid.map(async ({ ticket, path }) => ({
        ticket,
        photo: path ? urls[path] ?? null : null,
        qr: await qrSvg(trackingUrl(ticket.tracking_token), 120),
      })));
      // بترتيب رقم التذكرة — نفس ترتيب إدخالها.
      out.sort((a, b) => a.ticket.ticket_number.localeCompare(b.ticket.ticket_number));
      setPieces(out);
    })();
  }, [ids.join(",")]);

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
        <small>عدد القطع</small>
        <b>{pieces.length} قطع</b>
        <span>{formatDateTime(first.received_at)}</span>
      </div>

      <div className="a5-body a5-body-multi">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" className="a5-watermark" />

        <dl className="a5-details a5-grid2">
          <Row label="الزبون" value={first.customer?.full_name ?? "—"} />
          <Row label="الهاتف" value={first.customer?.phone ?? "—"} ltr />
          {first.promised_at && <Row label="موعد التسليم" value={formatDateTime(first.promised_at)} />}
          {first.received_by_staff?.full_name && <Row label="الموظف" value={first.received_by_staff.full_name} />}
          {first.branch?.name && <Row label="الفرع" value={first.branch.name} />}
        </dl>

        <p className="a5-title">القطع</p>
        <table className="a5-table">
          <thead>
            <tr>
              <th>#</th>
              <th />
              <th className="a5-col-item">القطعة</th>
              <th>المطلوب</th>
              <th>السعر</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map(({ ticket: t, photo }, i) => (
              <tr key={t.id}>
                <td className="a5-num">{i + 1}</td>
                <td>{photo ? <img src={photo} alt="" className="a5-thumb" /> : <span className="a5-thumb a5-thumb-empty" />}</td>
                <td>
                  <b>{t.item_name}</b>
                  <span className="a5-sub">
                    {[t.karat, t.weight_in_grams !== null ? formatWeight(t.weight_in_grams) : null].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td><span className="a5-clamp">{t.problem_description}</span></td>
                <td className="a5-cost">{t.estimated_cost !== null ? formatMoney(t.estimated_cost) : "لاحقاً"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="a5-price">
          <span>
            الإجمالي التقريبي
            {totalWeight > 0 && <> · الوزن {formatWeight(totalWeight)}</>}
            {priced.length < pieces.length && <> · بعض الأسعار لاحقاً</>}
          </span>
          <b>{priced.length ? formatMoney(total) : "لاحقاً"}</b>
        </div>

        {/* رمز متابعة لكل قطعة — الزبون يمسح رمز القطعة التي يسأل عنها. */}
        <div className="a5-qrs">
          {pieces.map(({ ticket: t, qr }, i) => (
            <div key={t.id} className="a5-qr-item">
              <div className="a5-frame"><div className="a5-qr a5-qr-sm" dangerouslySetInnerHTML={{ __html: qr }} /></div>
              <span className="a5-caption a5-qr-num" dir="ltr">{t.ticket_number} · {i + 1}</span>
            </div>
          ))}
        </div>
        <p className="a5-caption text-center">امسح رمز القطعة لمتابعة حالتها</p>
      </div>

      <div className="a5-signs">
        <div>توقيع الموظف</div>
        <div>توقيع الزبون</div>
      </div>

      <footer className="a5-foot">
        <p>{settings.receipt_footer}</p>
        {first.branch?.phone && <p dir="ltr">{first.branch.phone}</p>}
      </footer>
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
