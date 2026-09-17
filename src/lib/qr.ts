/**
 * رابط التتبّع العام كما يفتحه الزبون.
 *
 * يُبنى من عنوان الصفحة الحالية لا من إعداد ثابت: الموقع يُقدَّم من مسار فرعي
 * على GitHub Pages، وأي عنوان مكتوب يدوياً يصبح خاطئاً بمجرّد تغيّر الاستضافة.
 *
 * رمز QR أُلغي من الإيصال؛ الزبون يصل للرابط عبر رسالة واتساب التي يرسلها
 * الموظف، وهي تحمله أصلاً.
 */
export function trackingUrl(token: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, "");
  return `${base}/track/${token}`;
}
