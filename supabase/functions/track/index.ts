// صفحة التتبّع العامة: يفتحها الزبون بمسح رمز QR بلا تسجيل دخول.
//
// لا نمنح anon أي وصول للجداول، فالقراءة تمرّ من هنا بمفتاح الخدمة وتُرجع الحد
// الأدنى الذي يخصّ الزبون: الحالة والتواريخ واسم القطعة. لا أسعار ولا هواتف ولا
// بيانات موظفين، ولا شيء عن تذاكر أخرى.
//
// الرمز عشوائي 128 بت وهو كل ما يحمي التذكرة، لذا لا نكشف به إلا ما يراه صاحبها.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = (new URL(req.url).searchParams.get("token") ?? "").trim();
  // الرمز دائماً 32 محرفاً ست عشرياً؛ رفض ما عداه يوفّر استعلاماً ويقطع العبث.
  if (!/^[0-9a-f]{32}$/.test(token)) return json({ error: "invalid_token" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: ticket, error } = await admin
    .from("repair_tickets")
    .select("id, ticket_number, item_name, status, received_at, promised_at, ready_at, delivered_at, branch:branches(name, phone)")
    .eq("tracking_token", token)
    .maybeSingle();

  if (error) {
    console.error("track lookup failed", error.message);
    return json({ error: "server_error" }, 500);
  }
  if (!ticket) return json({ error: "not_found" }, 404);

  // صور الاستلام والتسليم فقط — صور العمل الداخلي لا تخصّ الزبون.
  const { data: photos } = await admin
    .from("repair_photos")
    .select("storage_path")
    .eq("ticket_id", ticket.id)
    .eq("is_public", true)
    .order("created_at", { ascending: true });

  let photoUrls: string[] = [];
  const paths = (photos ?? []).map((p) => p.storage_path as string);
  if (paths.length > 0) {
    const { data: signed } = await admin.storage.from("repair-photos").createSignedUrls(paths, 3600);
    photoUrls = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
  }

  const { data: settings } = await admin
    .from("settings")
    .select("key, value")
    .in("key", ["shop_name", "receipt_footer"]);
  const shop = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));

  // معرّف التذكرة الداخلي لا يخرج — الرمز وحده هو ما يعرفه الزبون.
  return json({
    ticket: {
      ticket_number: ticket.ticket_number,
      item_name: ticket.item_name,
      status: ticket.status,
      received_at: ticket.received_at,
      promised_at: ticket.promised_at,
      ready_at: ticket.ready_at,
      delivered_at: ticket.delivered_at,
      branch_name: (ticket as any).branch?.name ?? null,
      branch_phone: (ticket as any).branch?.phone ?? null,
    },
    photos: photoUrls,
    shop_name: shop.shop_name ?? "مجوهرات",
    receipt_footer: shop.receipt_footer ?? "",
  });
});
