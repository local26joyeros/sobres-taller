-- Solo los usuarios listados en usuarios_autorizados pueden ver o cargar datos y fotos.
create table usuarios_autorizados (user_id uuid primary key references auth.users(id) on delete cascade);
alter table usuarios_autorizados enable row level security;
create policy "ver propio" on usuarios_autorizados for select to authenticated using (user_id = (select auth.uid()));
insert into usuarios_autorizados select id from auth.users where email = 'local26joyeros@gmail.com';

create or replace function es_autorizado() returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from usuarios_autorizados where user_id = (select auth.uid()))
$$;
revoke execute on function es_autorizado from public, anon;
grant execute on function es_autorizado to authenticated;

-- Políticas restrictivas: se suman a las existentes y exigen ser usuario autorizado
create policy "solo autorizados" on clientes as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));
create policy "solo autorizados" on talleristas as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));
create policy "solo autorizados" on facturas as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));
create policy "solo autorizados" on trabajos as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));
create policy "solo autorizados" on historial_estados as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));
create policy "solo autorizados" on movimientos_cuenta as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));
create policy "fotos solo autorizados" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'fotos' or (select es_autorizado())) with check (bucket_id <> 'fotos' or (select es_autorizado()));
