-- المحل يتعامل بعيارَي 18K و21K فقط. القيمة الفارغة مسموحة (عيار غير محدّد).
ALTER TABLE public.repair_tickets
  ADD CONSTRAINT repair_tickets_karat_check CHECK (karat IS NULL OR karat IN ('18K', '21K'));
