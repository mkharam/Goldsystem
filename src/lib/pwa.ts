/**
 * تسجيل الخدمة العاملة — يفشل بصمت في أي بيئة لا تدعمها (لا يمنع التطبيق من
 * العمل)، ولا يعمل أثناء التطوير المحلي حتى لا يخدم نسخة مخزّنة قديمة.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
