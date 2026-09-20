import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
type ToastFn = (message: string, tone?: Toast["tone"]) => void;

const ToastContext = createContext<ToastFn | null>(null);

/**
 * تأكيدات صغيرة لأفعال لا تستحقّ رسالة كاملة ولا تنقل المستخدم لصفحة أخرى —
 * "تم رفع الصورة"، "تم النسخ". تختفي من تلقاء نفسها، ولا تحتاج قراءة متأنّية.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback<ToastFn>((message, tone = "success") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter pointer-events-auto max-w-xs rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
              t.tone === "error" ? "bg-red-600" : t.tone === "info" ? "bg-slate-800" : "bg-brand-700"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast خارج ToastProvider");
  return ctx;
}
