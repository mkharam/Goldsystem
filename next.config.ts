import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // الصور تُقدَّم عبر روابط موقّعة من Supabase Storage تمرّ من مسار داخلي،
  // فلا حاجة لتحسين Next لها ولا لقائمة نطاقات مسموحة.
  images: { unoptimized: true },
};

export default nextConfig;
