import { useEffect, useRef, useState } from "react";

/**
 * سحب لأسفل من أعلى الصفحة لتحديثها — التطبيق المثبّت على آيفون لا يملك هذه الميزة.
 * لا يعمل إلا إذا كانت الصفحة في أعلاها، وعند تجاوز مسافة السحب يعيد تحميل الصفحة.
 */
const TRIGGER = 80;

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const dist = useRef(0);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      // لا نتدخل إذا كانت الصفحة ممرَّرة، أو داخل نافذة/قائمة قابلة للتمرير.
      const t = e.target as HTMLElement | null;
      if (window.scrollY > 0 || t?.closest("[data-no-pull], .fixed")) { start.current = null; return; }
      start.current = e.touches[0].clientY;
      dist.current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return;
      const d = e.touches[0].clientY - start.current;
      if (d <= 0 || window.scrollY > 0) { dist.current = 0; setPull(0); return; }
      dist.current = Math.min(d * 0.5, 120);
      setPull(dist.current);
    };
    const onEnd = () => {
      if (start.current == null) return;
      start.current = null;
      if (dist.current >= TRIGGER) {
        setRefreshing(true);
        setPull(TRIGGER);
        window.location.reload();
      } else setPull(0);
      dist.current = 0;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (pull <= 0 && !refreshing) return null;
  const ready = pull >= TRIGGER;
  return (
    <div
      className="no-print pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
      style={{ transform: `translateY(${pull - 40}px)` }}
    >
      <div className="mt-[env(safe-area-inset-top)] flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md">
        <svg
          viewBox="0 0 24 24"
          className={`h-5 w-5 text-brand-700 ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${(pull / TRIGGER) * 270}deg)`, opacity: ready ? 1 : 0.6 }}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </svg>
      </div>
    </div>
  );
}
