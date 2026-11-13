-- ============ Renglones de factura ============
-- Cada ítem se factura con su propia hechura, moneda, metal y peso (o el sobre completo en un solo renglón).
-- Los ítems con presupuesto rechazado van a la factura como "Devolución", sin valores.
create table factura_lineas (
  id bigint generated always as identity primary key,
  factura_id bigint not null references facturas(id) on delete cascade,
  trabajo_id bigint not null references trabajos(id) on delete cascade,
  item_id bigint references items(id) on delete set null,
  descripcion text,
  devolucion boolean not null default false,
  hechura numeric(14,2),
  moneda moneda,
  metal metal,
  peso numeric(10,3),            -- oro: 18k; plata/platino: fino
  peso_fino numeric(10,3) generated always as (
    case when metal = 'oro' then round(peso * 0.825, 3) else peso end
  ) stored
);
create index on factura_lineas (factura_id);
create index on factura_lineas (trabajo_id);
alter table factura_lineas enable row level security;
create policy "acceso autenticado" on factura_lineas for all to authenticated using (true) with check (true);
create policy "solo autorizados" on factura_lineas as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));

-- Las facturas que ya existían: un renglón por sobre con lo que se había cargado
insert into factura_lineas (factura_id, trabajo_id, hechura, moneda, metal, peso)
select factura_id, id, hechura, hechura_moneda, metal, peso from trabajos where factura_id is not null;
insert into factura_lineas (factura_id, trabajo_id, item_id, descripcion, devolucion)
select t.factura_id, t.id, i.id, coalesce(i.nombre, i.descripcion), true
from trabajos t join items i on i.trabajo_id = t.id where t.factura_id is not null and i.estado = 'rechazado';

-- Facturar sobres de UN cliente.
-- p: { cliente_id,
--      sobres: [{ trabajo_id, lineas: [{ item_id|null, descripcion, hechura, moneda, metal, peso }] }],
--      nuevos: [{ nro_sobre, lineas: [{ nombre, descripcion, hechura, moneda, metal, peso }] }] }   -- piezas fabricadas, se facturan en el momento
create or replace function facturar_cliente(p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare
  v_cli bigint := (p->>'cliente_id')::bigint;
  v_fact bigint; s jsonb; l jsonb; v_trab bigint; v_item bigint; n int; v_cli_t bigint; v_est estado_trabajo;
begin
  if jsonb_array_length(coalesce(p->'sobres','[]'::jsonb)) + jsonb_array_length(coalesce(p->'nuevos','[]'::jsonb)) = 0 then
    raise exception 'No hay sobres para facturar';
  end if;
  insert into facturas default values returning id into v_fact;

  -- Sobres que ya estaban listos para facturar
  for s in select * from jsonb_array_elements(coalesce(p->'sobres','[]'::jsonb)) loop
    v_trab := (s->>'trabajo_id')::bigint;
    select cliente_id, estado into v_cli_t, v_est from trabajos where id = v_trab;
    if v_cli_t is distinct from v_cli then raise exception 'Todos los sobres de una factura tienen que ser del mismo cliente'; end if;
    if v_est <> 'listo_para_facturar' then raise exception 'Un sobre no está listo para facturar'; end if;
    for l in select * from jsonb_array_elements(coalesce(s->'lineas','[]'::jsonb)) loop
      insert into factura_lineas (factura_id, trabajo_id, item_id, descripcion, hechura, moneda, metal, peso)
      values (v_fact, v_trab, nullif(l->>'item_id','')::bigint, nullif(trim(l->>'descripcion'),''),
        nullif(l->>'hechura','')::numeric, case when nullif(l->>'hechura','') is null then null else nullif(l->>'moneda','')::moneda end,
        nullif(l->>'metal','')::metal, nullif(l->>'peso','')::numeric);
    end loop;
    -- Presupuestos rechazados: "Devolución"
    insert into factura_lineas (factura_id, trabajo_id, item_id, descripcion, devolucion)
    select v_fact, v_trab, i.id, coalesce(i.nombre, i.descripcion), true from items i where i.trabajo_id = v_trab and i.estado = 'rechazado';
    update trabajos set estado = 'facturado', factura_id = v_fact, facturado_en = now() where id = v_trab;
  end loop;

  -- Sobres nuevos (piezas fabricadas): se crean y se facturan en el momento
  for s in select * from jsonb_array_elements(coalesce(p->'nuevos','[]'::jsonb)) loop
    insert into trabajos (nro_sobre, cliente_id, tipo, estado)
    values (trim(s->>'nro_sobre'), v_cli, 'trabajo_nuevo', 'listo_para_facturar') returning id into v_trab;
    n := 0;
    for l in select * from jsonb_array_elements(coalesce(s->'lineas','[]'::jsonb)) loop
      n := n + 1;
      insert into items (trabajo_id, numero, nombre, descripcion, estado)
      values (v_trab, n, nullif(trim(l->>'nombre'),''), nullif(trim(l->>'descripcion'),''), 'listo') returning id into v_item;
      insert into factura_lineas (factura_id, trabajo_id, item_id, descripcion, hechura, moneda, metal, peso)
      values (v_fact, v_trab, v_item, coalesce(nullif(trim(l->>'nombre'),''), nullif(trim(l->>'descripcion'),'')),
        nullif(l->>'hechura','')::numeric, case when nullif(l->>'hechura','') is null then null else nullif(l->>'moneda','')::moneda end,
        nullif(l->>'metal','')::metal, nullif(l->>'peso','')::numeric);
    end loop;
    if n = 0 then raise exception 'El sobre nuevo % no tiene ítems', s->>'nro_sobre'; end if;
    update trabajos set estado = 'facturado', factura_id = v_fact, facturado_en = now() where id = v_trab;
  end loop;

  -- Cuenta corriente del cliente: un movimiento por renglón facturado
  insert into movimientos_cuenta (cliente_id, tipo, trabajo_id, factura_id, hechuras, dolares, oro_fino, platino, plata_fina, nota)
  select v_cli, 'facturacion', fl.trabajo_id, v_fact,
    case when fl.moneda = 'ARS' then coalesce(fl.hechura,0) else 0 end,
    case when fl.moneda = 'USD' then coalesce(fl.hechura,0) else 0 end,
    case when fl.metal = 'oro' then coalesce(fl.peso_fino,0) else 0 end,
    case when fl.metal = 'platino' then coalesce(fl.peso_fino,0) else 0 end,
    case when fl.metal = 'plata' then coalesce(fl.peso_fino,0) else 0 end,
    'Sobre ' || t.nro_sobre || coalesce(' · ' || fl.descripcion, '')
  from factura_lineas fl join trabajos t on t.id = fl.trabajo_id
  where fl.factura_id = v_fact and not fl.devolucion;

  return v_fact;
end $$;
revoke execute on function facturar_cliente from public, anon;
grant execute on function facturar_cliente to authenticated;
