-- رقم تذكرة قصير: اختصار الفرع + رقم متسلسل (AND-19) بدل R-26-01-0019.
-- العدّاد لا يُصفَّر سنوياً (صف السنة 0 في ticket_counters) حتى لا يتكرّر رقم أبداً —
-- ticket_number فريد. التذاكر القديمة تبقى بأرقامها، وكل فرع يكمل من عدد تذاكره الحالي.
alter table public.branches add column if not exists prefix text;

update public.branches set prefix = v.prefix
from (values ('01', 'AND'), ('02', 'QAD'), ('03', 'JRB'), ('04', 'NOF'), ('05', 'ASH')) as v(code, prefix)
where branches.code = v.code and (branches.prefix is null or branches.prefix = '');

insert into public.ticket_counters (branch_id, year, last_seq)
select b.id, 0, (select count(*) from public.repair_tickets t where t.branch_id = b.id)
from public.branches b
on conflict (branch_id, year) do nothing;

create or replace function public.next_ticket_number(p_branch_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_seq int;
  v_prefix text;
begin
  insert into public.ticket_counters (branch_id, year, last_seq)
  values (p_branch_id, 0, 1)
  on conflict (branch_id, year)
  do update set last_seq = public.ticket_counters.last_seq + 1
  returning last_seq into v_seq;

  select coalesce(nullif(upper(prefix), ''), 'B' || coalesce(nullif(code, ''), '0'))
    into v_prefix
  from public.branches where id = p_branch_id;

  return v_prefix || '-' || v_seq;
end;
$function$;
