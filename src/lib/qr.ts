import QRCode from "qrcode";

/**
 * رابط التتبّع العام كما يفتحه الزبون.
 *
 * يُبنى من عنوان الصفحة الحالية لا من إعداد ثابت: على GitHub Pages يُقدَّم
 * الموقع من مسار فرعي، وأي عنوان مكتوب يدوياً يصبح خاطئاً بمجرّد تغيّر
 * الاستضافة — ورمز QR مطبوع على إيصال بيد الزبون لا يمكن تصحيحه لاحقاً.
 */
export function trackingUrl(token: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, "");
  return `${base}/track/${token}`;
}

/** رمز QR كـ SVG مضمّن — بلا ملف ولا طلب شبكة، فيطبع بثبات. */
export function qrSvg(text: string, size = 150): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 0, width: size, errorCorrectionLevel: "M" });
}
