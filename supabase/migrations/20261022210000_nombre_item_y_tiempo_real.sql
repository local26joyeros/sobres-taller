-- Nombre corto de cada ítem para identificarlo dentro del sobre
alter table items add column nombre text;

-- Actualización automática en la app (tiempo real)
alter publication supabase_realtime add table trabajos, items, traspasos_taller, talleristas, clientes;

-- agregar_item con nombre (la versión de 3 parámetros sigue existiendo; la app usa esta)
create or replace function agregar_item(p_trabajo bigint, p_descripcion text, p_tallerista bigint default null, p_nombre text default null) returns bigint
language plpgsql set search_path = public as $$
declare v_item bigint; v_estado estado_trabajo;
begin
  select estado into v_estado from trabajos where id = p_trabajo;
  if v_estado in ('facturado','entregado') then raise exception 'El sobre ya está facturado'; end if;
  insert into items (trabajo_id, numero, nombre, descripcion, tallerista_id, estado)
  values (p_trabajo, (select coalesce(max(numero),0)+1 from items where trabajo_id = p_trabajo), nullif(trim(p_nombre),''), nullif(trim(p_descripcion),''), p_tallerista, 'taller')
  returning id into v_item;
  if p_tallerista is not null then
    insert into traspasos_taller (trabajo_id, item_id, tallerista_id) values (p_trabajo, v_item, p_tallerista);
  end if;
  perform sincronizar_sobre(p_trabajo);
  return v_item;
end $$;
revoke execute on function agregar_item(bigint, text, bigint, text) from public, anon;
grant execute on function agregar_item(bigint, text, bigint, text) to authenticated;

-- crear_sobre guarda también el nombre de cada ítem
create or replace function crear_sobre(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_trab bigint; v_item bigint; it jsonb; n int := 0; ids jsonb := '[]'::jsonb;
  v_tipo tipo_ingreso := (p->>'tipo')::tipo_ingreso;
begin
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'El sobre tiene que tener al menos un ítem'; end if;
  insert into trabajos (nro_sobre, cliente_id, tipo, estado)
  values (trim(p->>'nro_sobre'), (p->>'cliente_id')::bigint, v_tipo,
          case when v_tipo = 'presupuesto' then 'esperando_confirmacion' else 'taller' end::estado_trabajo)
  returning id into v_trab;
  for it in select * from jsonb_array_elements(p->'items') loop
    n := n + 1;
    insert into items (trabajo_id, numero, nombre, descripcion, tallerista_id, estado,
      presupuesto_hechura, presupuesto_moneda, presupuesto_metal, presupuesto_peso)
    values (v_trab, n, nullif(trim(it->>'nombre'),''), nullif(trim(it->>'descripcion'),''), nullif(it->>'tallerista_id','')::bigint,
      case when v_tipo = 'presupuesto' then 'pendiente' else 'taller' end,
      nullif(it->>'presupuesto_hechura','')::numeric, nullif(it->>'presupuesto_moneda','')::moneda,
      nullif(it->>'presupuesto_metal','')::metal, nullif(it->>'presupuesto_peso','')::numeric)
    returning id into v_item;
    if v_tipo <> 'presupuesto' and nullif(it->>'tallerista_id','') is not null then
      insert into traspasos_taller (trabajo_id, item_id, tallerista_id) values (v_trab, v_item, (it->>'tallerista_id')::bigint);
    end if;
    ids := ids || to_jsonb(v_item);
  end loop;
  return jsonb_build_object('trabajo_id', v_trab, 'items', ids);
end $$;
