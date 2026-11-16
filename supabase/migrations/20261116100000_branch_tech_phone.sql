-- فني لكل فرع: رقم واتساب فني الفرع (إن فرغ يُستعمل الرقم العام repairman_phone من الإعدادات).
alter table public.branches add column if not exists tech_phone text;
create or replace function public.set_branch_tech_phone(p_branch_id uuid, p_phone text)
returns void language sql security definer set search_path = public as $$
  update branches set tech_phone = nullif(trim(p_phone), '')
  where id = p_branch_id
    and exists (select 1 from staff s where s.auth_user_id = auth.uid()
                and (s.role = 'admin' or s.branch_id = p_branch_id));
$$;
revoke all on function public.set_branch_tech_phone(uuid, text) from public, anon;
grant execute on function public.set_branch_tech_phone(uuid, text) to authenticated;
