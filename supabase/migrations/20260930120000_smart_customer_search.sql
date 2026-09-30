-- بحث أذكى باسم الزبون: يتجاهل فروق الكتابة الشائعة (أ/إ/آ/ا، ة/ه، ى/ي، ؤ، ئ،
-- التشكيل، التطويل، والمسافات مثل «عبد الله»/«عبدالله»)، وكل كلمة من البحث يجب أن
-- تكون في الاسم بأي ترتيب («محمد علي» يجد «علي محمد»).
create or replace function public.ar_norm(t text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    translate(lower(coalesce(t, '')), 'أإآٱةىؤئ', 'ااااهيوي'),
    '[ًٌٍَُِّْـ[:space:]]+', '', 'g'
  );
$$;

-- security invoker: سياسات RLS على customers تبقى هي الحاكمة.
create or replace function public.search_customer_ids(q text)
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select c.id
  from customers c
  where exists (select 1 from unnest(regexp_split_to_array(trim(q), '[[:space:]]+')) w where w <> '')
    and (
      select bool_and(public.ar_norm(c.full_name) like '%' || public.ar_norm(w) || '%')
      from unnest(regexp_split_to_array(trim(q), '[[:space:]]+')) w
      where w <> ''
    )
  limit 100;
$$;

revoke all on function public.search_customer_ids(text) from public, anon;
grant execute on function public.search_customer_ids(text) to authenticated;
grant execute on function public.ar_norm(text) to authenticated;
