-- Agregar un ítem a un sobre existente. En sobres de presupuesto queda Pendiente con su propio presupuesto
-- (hechura, metal y peso opcionales) hasta que el cliente lo acepte o rechace.
-- p: {trabajo_id, nombre, descripcion, tallerista_id, presupuesto_hechura, presupuesto_moneda, presupuesto_metal, presupuesto_peso}
create or replace function agregar_item_sobre(p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare v_item bigint; v_trab bigint := (p->>'trabajo_id')::bigint; v_tipo tipo_ingreso; v_estado estado_trabajo;
  v_tall bigint := nullif(p->>'tallerista_id','')::bigint;
begin
  select tipo, estado into v_tipo, v_estado from trabajos where id = v_trab;
  if not found then raise exception 'Sobre inexistente'; end if;
  if v_estado in ('facturado','entregado') then raise exception 'El sobre ya está facturado'; end if;
  insert into items (trabajo_id, numero, nombre, descripcion, tallerista_id, estado,
    presupuesto_hechura, presupuesto_moneda, presupuesto_metal, presupuesto_peso)
  values (v_trab, (select coalesce(max(numero),0)+1 from items where trabajo_id = v_trab),
    nullif(trim(p->>'nombre'),''), nullif(trim(p->>'descripcion'),''), v_tall,
    case when v_tipo = 'presupuesto' then 'pendiente' else 'taller' end,
    nullif(p->>'presupuesto_hechura','')::numeric, nullif(p->>'presupuesto_moneda','')::moneda,
    nullif(p->>'presupuesto_metal','')::metal, nullif(p->>'presupuesto_peso','')::numeric)
  returning id into v_item;
  if v_tipo <> 'presupuesto' and v_tall is not null then
    insert into traspasos_taller (trabajo_id, item_id, tallerista_id) values (v_trab, v_item, v_tall);
  end if;
  perform sincronizar_sobre(v_trab);
  return v_item;
end $$;
revoke execute on function agregar_item_sobre from public, anon;
grant execute on function agregar_item_sobre to authenticated;
