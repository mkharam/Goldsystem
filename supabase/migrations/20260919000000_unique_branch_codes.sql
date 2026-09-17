-- =====================================================================
-- كود الفرع يجب أن يكون فريداً
--
-- رقم التذكرة يُبنى كـ R-<سنة>-<كود الفرع>-<تسلسل> والعدّاد مستقل لكل فرع،
-- فإن تشارك فرعان الكود نفسه ولّدا الرقم ذاته — و ticket_number فريد إجبارياً،
-- فتفشل أول تذكرة في الفرع الثاني بخطأ تعارض غامض أمام الموظف.
--
-- في المخزون ثلاثة فروع تحمل الكود "BRA"، لذلك نفرض التفرّد هنا ونشتقّ كوداً
-- بديلاً عند التعارض بدل الوثوق بما يأتي من هناك.
-- =====================================================================

/**
 * كود فريد مقترح: يُفضّل الكود القادم من المخزون، وعند شغله يُرجع أصغر رقم
 * ثنائي حر. p_branch_id يستثني الفرع نفسه حتى لا يتعارض مع كوده الحالي.
 */
CREATE OR REPLACE FUNCTION public.allocate_branch_code(p_desired TEXT, p_branch_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT := NULLIF(btrim(COALESCE(p_desired, '')), '');
  v_n INT := 1;
BEGIN
  IF v_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE code = v_code AND (p_branch_id IS NULL OR id <> p_branch_id)
  ) THEN
    RETURN v_code;
  END IF;

  WHILE v_n < 100 LOOP
    v_code := to_char(v_n, 'FM00');
    IF NOT EXISTS (
      SELECT 1 FROM public.branches
      WHERE code = v_code AND (p_branch_id IS NULL OR id <> p_branch_id)
    ) THEN
      RETURN v_code;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- أكثر من 99 فرعاً: نرجع لمقطع من معرّف عشوائي بدل الفشل.
  RETURN upper(substr(encode(gen_random_bytes(2), 'hex'), 1, 3));
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_branch_code(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_branch_code(TEXT, UUID) TO service_role;

-- تصحيح أي تكرار قائم قبل فرض القيد.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY code ORDER BY created_at) AS rn
      FROM public.branches WHERE code IS NOT NULL
    ) dup WHERE rn > 1
  LOOP
    UPDATE public.branches SET code = public.allocate_branch_code(NULL, r.id) WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS branches_code_key ON public.branches (code) WHERE code IS NOT NULL;
