-- Registro (no se factura): gramos de oro 18k que se le dieron al tallerista
alter table traspasos_taller add column pago_oro18 numeric(10,3);

-- Nota: la versión anterior marcar_listo(bigint, numeric, moneda) sigue existiendo;
-- la app siempre llama a esta con los 4 parámetros.
create or replace function marcar_listo(p_trabajo bigint, p_pago numeric, p_moneda moneda default 'ARS', p_oro18 numeric default null)
returns void language plpgsql set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  update trabajos set estado = 'listo_para_facturar' where id = p_trabajo and estado = 'taller';
  if not found then raise exception 'El sobre no está en taller'; end if;
  update traspasos_taller set hasta = v_hoy, pago = p_pago, pago_moneda = case when p_pago is null then null else p_moneda end, pago_oro18 = p_oro18
  where id = (select id from traspasos_taller where trabajo_id = p_trabajo order by fecha desc, id desc limit 1);
end $$;
revoke execute on function marcar_listo(bigint, numeric, moneda, numeric) from public, anon;
grant execute on function marcar_listo(bigint, numeric, moneda, numeric) to authenticated;
