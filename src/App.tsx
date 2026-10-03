import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/lib/toast";
import Login from "@/pages/Login";
import { ResumeRoute } from "@/lib/resume";

// كل صفحة بعد تسجيل الدخول في حزمة منفصلة تُحمَّل عند الحاجة فقط — على اتصال
// ضعيف يفتح تسجيل الدخول فوراً بدل انتظار كل الصفحات معاً في حزمة واحدة ضخمة.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const NewTicket = lazy(() => import("@/pages/NewTicket"));
const TicketDetail = lazy(() => import("@/pages/TicketDetail"));
const Receipt = lazy(() => import("@/pages/Receipt"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const Track = lazy(() => import("@/pages/Track"));

function PageFallback() {
  return <div className="flex min-h-dvh items-center justify-center text-slate-400">جارٍ التحميل…</div>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { staff, loading } = useAuth();

  // بلا هذا الانتظار تومض صفحة الدخول للحظة عند كل تحديث قبل أن تُقرأ الجلسة.
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-slate-400">جارٍ التحميل…</div>
    );
  }

  if (!staff) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      {/* basename يجعل المسارات تعمل تحت /Goldsystem/ على GitHub Pages ومن الجذر محلياً. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ResumeRoute />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* صفحة التتبّع عامة: يفتحها الزبون بمسح الرمز بلا تسجيل دخول. */}
            <Route path="/track/:token" element={<Track />} />

            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            {/* صفحة التذاكر أُلغيت — الرئيسية فيها كل التذاكر والبحث. الروابط القديمة تذهب إليها. */}
            <Route path="/tickets" element={<Navigate to="/" replace />} />
            <Route path="/tickets/new" element={<Protected><NewTicket /></Protected>} />
            <Route path="/tickets/:id" element={<Protected><TicketDetail /></Protected>} />
            <Route path="/tickets/:id/receipt" element={<Protected><Receipt /></Protected>} />
            <Route path="/receipts" element={<Protected><Receipt /></Protected>} />
            <Route path="/calendar" element={<Protected><Calendar /></Protected>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  );
}
