import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Tickets from "@/pages/Tickets";
import NewTicket from "@/pages/NewTicket";
import TicketDetail from "@/pages/TicketDetail";
import Receipt from "@/pages/Receipt";
import Track from "@/pages/Track";

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
    <AuthProvider>
      {/* basename يجعل المسارات تعمل تحت /Goldsystem/ على GitHub Pages ومن الجذر محلياً. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* صفحة التتبّع عامة: يفتحها الزبون بمسح الرمز بلا تسجيل دخول. */}
          <Route path="/track/:token" element={<Track />} />

          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/tickets" element={<Protected><Tickets /></Protected>} />
          <Route path="/tickets/new" element={<Protected><NewTicket /></Protected>} />
          <Route path="/tickets/:id" element={<Protected><TicketDetail /></Protected>} />
          <Route path="/tickets/:id/receipt" element={<Protected><Receipt /></Protected>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
