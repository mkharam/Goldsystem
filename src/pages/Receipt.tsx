import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTicket, getSettings, getPhotos, type Settings } from "@/lib/tickets";
import { signedPhotoUrls } from "@/lib/supabase";
import { formatDateTime, formatWeight, formatMoney } from "@/lib/format";
import { qrSvg, trackingUrl } from "@/lib/qr";
import { Logo } from "@/components/Logo";
import type { TicketWithRelations } from "@/lib/types";

// عرض الورقة بالبكسل عند 96dpi (118 مم) — نصغّر المعاينة على الشاشة الضيقة فقط.
const SHEET_PX = (118 / 25.4) * 96;

/**
 * إيصال بمقاس ثابت بالمليمتر (118×175 مم، راجع ‎.a5-sheet في index.css) يطبع كما هو على
 * ورقة A5 من آيفون أو لابتوب بلا تكبير ولا تصغير: أصغر من مساحة الطباعة في A5 حتى مع
 * هوامش سفاري الإجبارية، ولا يتجاوز صفحة واحدة مهما طال نص العطل.
 */
export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketWithRelations | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [qr, setQr] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [fit, setFit] = useState(1);
  const photoRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [t, s, photos] = await Promise.all([getTicket(id), getSettings(), getPhotos(id)]);
      setTicket(t);
      setSettings(s);
      // صورة القطعة عند الاستلام تحمي المحل والزبون معاً: شكلها كما سُلّمت، مطبوعاً على الإيصال.
      const first = photos.find((p) => p.stage === "intake") ?? photos[0];
      if (first) {
        const urls = await signedPhotoUrls([first.storage_path]);
        setPhoto(urls[first.storage_path] ?? null);
      }
      if (t) {
        const link = trackingUrl(t.tracking_token);
        setQr(await qrSvg(link, 150));
      }
    })();
  }, [id]);

  useEffect(() => {
    const update = () => setFit(Math.min(1, (window.innerWidth - 24) / SHEET_PX));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // لا نطبع قبل اكتمال تحميل الصورة، وإلا خرج الإيصال بمربع فارغ.
  async function print() {
    const img = photoRef.current;
    if (img && !img.complete) {
      await new Promise((resolve) => {
        img.onload = img.onerror = resolve;
      });
    }
    window.print();
  }

  if (!ticket || !settings) {
    return <div className="p-8 text-center text-slate-400">جارٍ التحميل…</div>;
  }

  return (
    <div className="py-4 print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[446px] gap-2 px-3">
        <Link to={`/tickets/${ticket.id}`} className="btn-ghost flex-1">التذكرة</Link>
        <button type="button" onClick={print} className="btn-primary flex-1">طباعة</button>
      </div>

      <div className="a5-sheet" style={{ "--fit": fit } as React.CSSProperties}>
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
                    <img ref={photoRef} src={photo} alt="صورة القطعة" />
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
