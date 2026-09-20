// خدمة عاملة بسيطة: هدفها الوحيد أن يفتح التطبيق فوراً من الشاشة الرئيسية
// حتى مع اتصال ضعيف، وليس تخزين البيانات — أي طلب لبيانات (Supabase، دوال
// الحافة) يتجاوز هذا الملف تماماً لأنه من أصل مختلف.
//
// النسخة تتغيّر يدوياً هنا: تغييرها يجعل المتصفح يحمّل الملف من جديد وينظّف
// الذاكرة المؤقتة القديمة تلقائياً في "activate".
const CACHE = "mkh-shell-v2";
const SCOPE = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new URL("./", SCOPE))).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // لا نلمس Supabase أو أي أصل آخر

  // تصفّح الصفحات: الشبكة أولاً، وعند الانقطاع نعرض آخر نسخة محفوظة من
  // الصفحة الرئيسية بدل رسالة خطأ فارغة من المتصفح.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(new URL("./", SCOPE)).then((r) => r ?? Response.error())),
    );
    return;
  }

  // الأصول الثابتة (JS/CSS/الصور المحلية): من الذاكرة إن وُجدت فوراً، مع
  // تحديثها في الخلفية دون انتظار — أسرع فتح تالٍ بلا تجميد على نسخة قديمة.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
