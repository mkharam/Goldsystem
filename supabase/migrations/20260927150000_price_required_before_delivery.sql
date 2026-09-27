-- سعر الصيانة إلزامي قبل تسليم القطعة للزبون. يمكن كتابته عند الاستلام (تقديري) أو عند
-- إنهاء العمل (نهائي)؛ إن لم يُعرف في أيٍّ منهما يُطلب عند التسليم. كان يمكن تسليم القطعة
-- بلا أي سعر فلا يُعرف كم دفع الزبون ولا يُحاسَب أحد.
-- حارس في قاعدة البيانات لا في الواجهة وحدها، حتى لا يتجاوزه أي مسار آخر.
create or replace function public.require_price_on_delivery()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    -- السعر التقديري المتفق عليه عند الاستلام يصبح النهائي إن لم يُكتب غيره.
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

drop trigger if exists repair_tickets_require_price on public.repair_tickets;
create trigger repair_tickets_require_price
  before update on public.repair_tickets
  for each row execute function public.require_price_on_delivery();
