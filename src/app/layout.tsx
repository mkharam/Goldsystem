import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "متابعة الصيانة",
  description: "نظام استلام ومتابعة وتسليم قطع الصيانة",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // الموظف يعمل على الهاتف بيد واحدة والقطعة في اليد الأخرى؛ نمنع التقريب العرضي.
  maximumScale: 5,
  themeColor: "#c8912f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
