-- السعر على مرحلتين: عند الاستلام من الزبون يُكتب "السعر التقريبي" (estimated_cost، اختياري)،
-- وحين تعود القطعة جاهزة للموظف يُدخل "السعر الحقيقي" (final_cost) — إلزامياً. التسليم يبقى
-- محروساً كما كان، ويسقط للتقريبي فقط للتذاكر التي صارت جاهزة قبل هذا التغيير.
create or replace function public.require_price_on_delivery()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' and new.final_cost is null then
    raise exception 'أدخل السعر الحقيقي عند استلام القطعة جاهزة';
  end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    if new.final_cost is null then
      new.final_cost := new.estimated_cost;
    end if;
    if new.final_cost is null then
      raise exception 'أدخل سعر الصيانة قبل تسليم القطعة للزبون';
    end if;
  end if;
  return new;
end;
$function$;
