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
  const [url, setUrl] = useState("");
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
        setUrl(link);
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
        <header className="a5-head">
          <div className="flex items-center gap-[3mm]">
            <Logo size={48} className="a5-logo" />
            <div>
              <h1 className="a5-shop">{settings.shop_name}</h1>
              <p className="a5-muted">إيصال استلام صيانة</p>
            </div>
          </div>
          <div className="a5-number">
            <p className="font-mono">{ticket.ticket_number}</p>
            <span>{formatDateTime(ticket.received_at)}</span>
          </div>
        </header>

        <div className="brand-hairline" />

        <div className="a5-body">
          <dl className="a5-details">
            <Row label="الزبون" value={ticket.customer?.full_name ?? "—"} />
            <Row label="الهاتف" value={ticket.customer?.phone ?? "—"} ltr />
            <Row label="القطعة" value={ticket.item_name} />
            {ticket.karat && <Row label="العيار" value={ticket.karat} />}
            {ticket.weight_in_grams !== null && <Row label="الوزن" value={formatWeight(ticket.weight_in_grams)} />}
            <Row label="العطل" value={ticket.problem_description} clamp />
            {ticket.estimated_cost !== null && <Row label="السعر التقريبي" value={formatMoney(ticket.estimated_cost)} />}
            {ticket.promised_at && <Row label="موعد التسليم" value={formatDateTime(ticket.promised_at)} />}
            {ticket.received_by_staff?.full_name && <Row label="الموظف" value={ticket.received_by_staff.full_name} />}
            {ticket.branch?.name && <Row label="الفرع" value={ticket.branch.name} />}
            {ticket.branch?.phone && <Row label="هاتف الفرع" value={ticket.branch.phone} ltr />}
          </dl>

          <aside className="a5-side">
            {photo && (
              <div className="a5-photo">
                <img ref={photoRef} src={photo} alt="صورة القطعة" />
              </div>
            )}
            {/* الزبون يتابع حالة قطعته بمسح الرمز — بلا تطبيق ولا تسجيل دخول. */}
            <div className="a5-qr" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="a5-muted text-center">امسح الرمز لمتابعة حالة قطعتك</p>
          </aside>
        </div>

        <footer className="a5-foot">
          <div className="brand-hairline" />
          <p>{settings.receipt_footer}</p>
          <p className="a5-url" dir="ltr">{url}</p>
        </footer>
      </div>
    </div>
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
