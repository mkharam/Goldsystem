#!/usr/bin/env bash
#
# يجهّز .env.local لتطبيق الصيانة، ويضبط المفتاح المشترك على مشروع المخزون.
#
# يُشغَّل على جهازك لا داخل جلسة مساعد: مفاتيح service_role تتجاوز RLS بالكامل،
# فلا يجوز أن تمرّ في نص محادثة أو سجلّ. لا يطبع هذا السكربت أي سرّ على الشاشة.
#
#   chmod +x scripts/setup-env.sh && ./scripts/setup-env.sh
#
set -euo pipefail

REPAIR_REF="nsbnrtoqqdlnzuzelubt"   # مشروع "jewelry repairs"
INVENTORY_REF="iiyaytfdxfvjcvzlnlpp" # مشروع المخزون "jewelry mkharam"
ENV_FILE=".env.local"

cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

command -v node >/dev/null || die "node غير مثبّت"

supabase() {
  if command -v supabase >/dev/null 2>&1; then command supabase "$@"; else npx --yes supabase "$@"; fi
}

say "١/٥ التحقق من تسجيل الدخول إلى Supabase"
if ! supabase projects list >/dev/null 2>&1; then
  echo "لست مسجّل الدخول. سيُفتح المتصفح لتسجيل الدخول…"
  supabase login
fi

if [ -f "$ENV_FILE" ]; then
  read -r -p "$ENV_FILE موجود مسبقاً — استبداله؟ [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "أُلغيت العملية"
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
  echo "نُسخت النسخة القديمة إلى $ENV_FILE.bak.*"
fi

say "٢/٥ جلب مفتاح service_role لمشروع الصيانة"
KEYS_JSON="$(supabase projects api-keys --project-ref "$REPAIR_REF" --reveal --output json)"

# أسماء الحقول تغيّرت بين إصدارات الـ CLI (anon/service_role ثم publishable/secret)،
# فنبحث عن أول مفتاح يبدو سرّياً بدل الاعتماد على اسم حقل بعينه.
SERVICE_KEY="$(PAYLOAD="$KEYS_JSON" node -e '
const rows = JSON.parse(process.env.PAYLOAD);
const list = Array.isArray(rows) ? rows : [rows];
const isSecret = (r) => /service_role|secret/i.test(String(r.name ?? r.type ?? r.id ?? ""));
const valueOf = (r) => r.api_key ?? r.apiKey ?? r.key ?? r.value ?? "";
const hit = list.find((r) => isSecret(r) && valueOf(r));
if (!hit) { console.error("لم يُعثر على مفتاح service_role في رد الـ CLI"); process.exit(1); }
process.stdout.write(String(valueOf(hit)));
')"
[ -n "$SERVICE_KEY" ] || die "تعذّر استخراج مفتاح service_role"
echo "تم (بطول ${#SERVICE_KEY} محرفاً)."

say "٣/٥ توليد الأسرار المحلية"
SESSION_SECRET="$(openssl rand -hex 32)"
REPAIR_API_KEY="$(openssl rand -hex 32)"
echo "تم توليد SESSION_SECRET و REPAIR_API_KEY."

say "٤/٥ ضبط REPAIR_API_KEY على مشروع المخزون"
if supabase secrets set "REPAIR_API_KEY=$REPAIR_API_KEY" --project-ref "$INVENTORY_REF" >/dev/null 2>&1; then
  echo "ضُبط المفتاح على $INVENTORY_REF."
else
  echo "تعذّر ضبطه آلياً — اضبطه يدوياً بالقيمة الموجودة في $ENV_FILE تحت INVENTORY_API_KEY:"
  echo "  supabase secrets set REPAIR_API_KEY=<القيمة> --project-ref $INVENTORY_REF"
fi

say "٥/٥ كتابة $ENV_FILE"
umask 077
cat > "$ENV_FILE" <<EOF
# وُلّد بواسطة scripts/setup-env.sh — لا تُضف هذا الملف إلى git
SUPABASE_URL=https://$REPAIR_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
SESSION_SECRET=$SESSION_SECRET

INVENTORY_API_URL=https://$INVENTORY_REF.supabase.co/functions/v1/repair-api
INVENTORY_API_KEY=$REPAIR_API_KEY

NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF
chmod 600 "$ENV_FILE"

say "تم."
cat <<'EOF'
التالي:
  npm run dev        ثم افتح http://localhost:3000
  ادخل بحساب موظف من نظام المخزون نفسه.

للتحقق من أن التكامل يعمل (يجب أن يردّ {"ok":true}):
  source .env.local && curl -s -H "x-api-key: $INVENTORY_API_KEY" \
    "$INVENTORY_API_URL/health"

عند النشر، انقل نفس المتغيّرات إلى مزوّد الاستضافة واضبط
NEXT_PUBLIC_APP_URL على العنوان العام (يدخل في رمز QR على الإيصال).
EOF
