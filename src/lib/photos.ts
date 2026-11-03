import { supabase, signedPhotoUrls, PHOTO_BUCKET } from "./supabase";
import { compressImage, makeThumbnail } from "./image";
import type { PhotoStage, RepairPhoto } from "./types";

let running = false;

/**
 * يولّد مصغّرات الصور القديمة (رُفعت قبل وجود المصغّرات) في الخلفية، دفعة صغيرة في
 * كل مرة، فتخفّ القوائم كلها دون أن يضطر أحد لفتح كل تذكرة. آمن للتكرار.
 */
export async function backfillThumbnails(batch = 12): Promise<number> {
  if (running) return 0;
  running = true;
  let made = 0;
  try {
    const { data: rows } = await supabase
      .from("repair_photos")
      .select("id, storage_path")
      .is("thumb_path", null)
      .limit(batch);
    if (!rows?.length) return 0;
    const urls = await signedPhotoUrls(rows.map((r) => r.storage_path));
    for (const row of rows) {
      const url = urls[row.storage_path];
      if (!url) continue;
      try {
        const blob = await (await fetch(url)).blob();
        const thumb = await makeThumbnail(new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
        if (!thumb) continue;
        const tPath = row.storage_path.replace(/\.\w+$/, "") + "-thumb.jpg";
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(tPath, thumb, {
          contentType: "image/jpeg", cacheControl: "31536000", upsert: true,
        });
        if (upErr) continue;
        const { error } = await supabase.from("repair_photos").update({ thumb_path: tPath }).eq("id", row.id);
        if (!error) made++;
      } catch { /* تبقى كاملة وتُعاد المحاولة لاحقاً */ }
    }
  } finally {
    running = false;
  }
  return made;
}

/**
 * يرفع صورة لتذكرة (مضغوطة + مصغّرة) ويسجّلها، ويعيد صفّ الصورة الجديد. فشل المصغّرة لا يمنع
 * حفظ الصورة؛ فشل الرفع الأصلي يعيد null.
 */
export async function uploadTicketPhoto(
  ticketId: string,
  file: File,
  staffId: string,
  stage: PhotoStage = "intake",
): Promise<RepairPhoto | null> {
  const full = await compressImage(file);
  const ext = full.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const stem = `${ticketId}/${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(`${stem}.${ext}`, full, {
    contentType: full.type || "image/jpeg",
    cacheControl: "31536000",
  });
  if (error) return null;

  let thumbPath: string | null = null;
  const thumb = await makeThumbnail(full);
  if (thumb) {
    const { error: thumbErr } = await supabase.storage.from(PHOTO_BUCKET).upload(`${stem}-thumb.jpg`, thumb, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
    });
    if (!thumbErr) thumbPath = `${stem}-thumb.jpg`;
  }

  const { data } = await supabase
    .from("repair_photos")
    .insert({
      ticket_id: ticketId,
      storage_path: `${stem}.${ext}`,
      thumb_path: thumbPath,
      stage,
      uploaded_by: staffId,
      is_public: stage !== "progress",
    })
    .select("*")
    .single();
  return (data as RepairPhoto | null) ?? null;
}
