-- Cada fila de traspasos_taller es una estadía del sobre en un taller:
--   fecha = cuándo se le entregó · hasta = cuándo salió · pago = cuánto se le pagó
alter table traspasos_taller add column hasta date;
alter table traspasos_taller add column pago numeric(14,2);
alter table traspasos_taller add column pago_moneda moneda;

-- Al pasar a otro taller, se cierra la estadía anterior
create or replace function asignar_tallerista(p_trabajo bigint, p_tallerista bigint, p_fecha date default null)
returns void language plpgsql set search_path = public as $$
declare v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
begin
  update trabajos set tallerista_id = p_tallerista where id = p_trabajo;
  if not found then raise exception 'Sobre inexistente'; end if;
  update traspasos_taller set hasta = v_fecha where trabajo_id = p_trabajo and hasta is null;
  insert into traspasos_taller (trabajo_id, tallerista_id, fecha) values (p_trabajo, p_tallerista, v_fecha);
end $$;

-- Listo para facturar: cierra la estadía actual y registra lo pagado al tallerista
create or replace function marcar_listo(p_trabajo bigint, p_pago numeric, p_moneda moneda default 'ARS')
returns void language plpgsql set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  update trabajos set estado = 'listo_para_facturar' where id = p_trabajo and estado = 'taller';
  if not found then raise exception 'El sobre no está en taller'; end if;
  update traspasos_taller set hasta = v_hoy, pago = p_pago, pago_moneda = p_moneda
  where id = (select id from traspasos_taller where trabajo_id = p_trabajo order by fecha desc, id desc limit 1);
end $$;

revoke execute on function marcar_listo from public, anon;
grant execute on function marcar_listo to authenticated;

-- Estadías ya existentes que no siguen abiertas
update traspasos_taller tt set hasta = coalesce(
  (select min(t2.fecha) from traspasos_taller t2 where t2.trabajo_id = tt.trabajo_id and (t2.fecha, t2.id) > (tt.fecha, tt.id)),
  (select (cambiado_en at time zone 'America/Argentina/Buenos_Aires')::date from historial_estados h
     where h.trabajo_id = tt.trabajo_id and h.estado_nuevo = 'listo_para_facturar' order by cambiado_en desc limit 1))
where hasta is null
  and (exists (select 1 from traspasos_taller t2 where t2.trabajo_id = tt.trabajo_id and (t2.fecha, t2.id) > (tt.fecha, tt.id))
       or (select estado from trabajos where id = tt.trabajo_id) <> 'taller');
