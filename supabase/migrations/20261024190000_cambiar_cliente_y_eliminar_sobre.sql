-- Cambiar el cliente de un sobre (si ya se facturó, lo facturado pasa a la cuenta del nuevo cliente)
create or replace function cambiar_cliente_sobre(p_trabajo bigint, p_cliente bigint) returns void
language plpgsql set search_path = public as $$
begin
  update trabajos set cliente_id = p_cliente where id = p_trabajo;
  if not found then raise exception 'Sobre inexistente'; end if;
  update movimientos_cuenta set cliente_id = p_cliente where trabajo_id = p_trabajo;
end $$;

-- Eliminar un sobre con todo lo suyo (ítems, talleres, fotos, historial y lo facturado en la cuenta del cliente)
create or replace function eliminar_sobre(p_trabajo bigint) returns void
language plpgsql set search_path = public as $$
declare v_factura bigint;
begin
  select factura_id into v_factura from trabajos where id = p_trabajo;
  if not found then raise exception 'Sobre inexistente'; end if;
  delete from movimientos_cuenta where trabajo_id = p_trabajo;
  delete from trabajos where id = p_trabajo;
  -- si la factura quedó vacía, se borra
  if v_factura is not null and not exists (select 1 from trabajos where factura_id = v_factura) then
    delete from movimientos_cuenta where factura_id = v_factura;
    delete from facturas where id = v_factura;
  end if;
end $$;

revoke execute on function cambiar_cliente_sobre, eliminar_sobre from public, anon;
grant execute on function cambiar_cliente_sobre, eliminar_sobre to authenticated;
