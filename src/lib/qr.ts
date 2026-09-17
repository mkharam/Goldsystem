import "server-only";
import QRCode from "qrcode";

export function trackingUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/track/${token}`;
}

/** رمز QR كـ SVG مضمّن — لا ملف ولا طلب شبكة، فيطبع بثبات على الطابعات الحرارية. */
export async function qrSvg(text: string, size = 160): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 0,
    width: size,
    errorCorrectionLevel: "M",
  });
}
