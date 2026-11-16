-- متى أُرسلت القطعة للفني (قائمة «إرسال للفني») — حتى لا تتكرر في الإرسال التالي.
alter table public.repair_tickets add column if not exists sent_to_tech_at timestamptz;
create or replace function public.mark_sent_to_tech(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update repair_tickets set sent_to_tech_at = now()
  where id = any(p_ids) and auth.uid() is not null
    and exists (select 1 from staff s where s.auth_user_id = auth.uid());
$$;
revoke all on function public.mark_sent_to_tech(uuid[]) from public, anon;
grant execute on function public.mark_sent_to_tech(uuid[]) to authenticated;
