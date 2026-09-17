/**
 * شعار مخرّم.
 *
 * الشعار صورة مربّعة (نص ذهبي على أخضر)، فنعرضه كشارة دائرية بإطار ذهبي رفيع
 * بدل محاولة فصل النص عن خلفيته — يبقى وفياً للأصل وواضحاً على أي سطح.
 * المسار نسبي عبر BASE_URL لأن الموقع يُقدَّم من مسار فرعي على GitHub Pages.
 */
export function Logo({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.jpg`}
      alt="مخرّم"
      width={size}
      height={size}
      className={`shrink-0 rounded-full object-cover ring-1 ring-gold-500/50 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
