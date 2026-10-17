-- ============ Ítems dentro de cada sobre ============
-- Cada ítem tiene su propia descripción, foto, tallerista, presupuesto y seguimiento.
-- El sobre se factura junto: pasa a "Listo para facturar" cuando todos sus ítems terminaron.
--   estado del ítem: pendiente (presupuesto sin respuesta) · taller · listo · rechazado

create table items (
  id bigint generated always as identity primary key,
  trabajo_id bigint not null references trabajos(id) on delete cascade,
  numero int not null,
  descripcion text,
  foto_path text,
  tallerista_id bigint references talleristas(id),
  estado text not null check (estado in ('pendiente','taller','listo','rechazado')),
  presupuesto_hechura numeric(14,2),
  presupuesto_moneda moneda,
  presupuesto_metal metal,
  presupuesto_peso numeric(10,3),
  presupuesto_respuesta text check (presupuesto_respuesta in ('aceptado','rechazado')),
  creado_en timestamptz not null default now(),
  unique (trabajo_id, numero)
);
create index on items (trabajo_id);
create index on items (estado);
alter table items enable row level security;
create policy "acceso autenticado" on items for all to authenticated using (true) with check (true);
create policy "solo autorizados" on items as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));

alter table traspasos_taller add column item_id bigint references items(id) on delete cascade;
create index on traspasos_taller (item_id);
alter table trabajo_fotos add column item_id bigint references items(id) on delete cascade;
create index on trabajo_fotos (item_id);

-- ---- Pasar los sobres existentes a un ítem cada uno ----
insert into items (trabajo_id, numero, descripcion, foto_path, tallerista_id, estado,
  presupuesto_hechura, presupuesto_moneda, presupuesto_metal, presupuesto_peso, presupuesto_respuesta)
select id, 1, descripcion, foto_path, tallerista_id,
  case
    when estado in ('presupuesto','esperando_confirmacion') then 'pendiente'
    when estado = 'taller' then 'taller'
    when estado = 'rechazado' or presupuesto_respuesta = 'rechazado' then 'rechazado'
    else 'listo'
  end,
  presupuesto_hechura, presupuesto_moneda, presupuesto_metal, presupuesto_peso, presupuesto_respuesta
from trabajos;
update traspasos_taller tt set item_id = i.id from items i where i.trabajo_id = tt.trabajo_id and tt.item_id is null;
update trabajo_fotos f set item_id = i.id from items i where i.trabajo_id = f.trabajo_id and f.item_id is null;

-- ---- Estado del sobre según sus ítems ----
create or replace function validar_estado() returns trigger language plpgsql
set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into historial_estados (trabajo_id, estado_anterior, estado_nuevo) values (new.id, null, new.estado);
    return new;
  end if;
  if new.estado is distinct from old.estado then
    if old.estado in ('facturado','entregado') and not (old.estado = 'facturado' and new.estado = 'entregado') then
      raise exception 'No se puede pasar de "%" a "%"', old.estado, new.estado;
    end if;
    if new.estado = 'facturado' and new.factura_id is null then
      raise exception 'Para facturar usá la pantalla de facturación';
    end if;
    if new.estado = 'entregado' and old.estado not in ('facturado','rechazado') then
      raise exception 'Solo se entrega un sobre facturado';
    end if;
    if new.estado = 'entregado' then new.entregado_en := now(); end if;
    insert into historial_estados (trabajo_id, estado_anterior, estado_nuevo) values (new.id, old.estado, new.estado);
  end if;
  return new;
end $$;

create or replace function sincronizar_sobre(p_trabajo bigint) returns void
language plpgsql set search_path = public as $$
declare v_estado estado_trabajo; v_actual estado_trabajo;
begin
  select estado into v_actual from trabajos where id = p_trabajo;
  if v_actual in ('facturado','entregado') then return; end if;
  select case
      when bool_or(estado = 'taller') then 'taller'
      when bool_or(estado = 'pendiente') then 'esperando_confirmacion'
      else 'listo_para_facturar'
    end::estado_trabajo
  into v_estado from items where trabajo_id = p_trabajo;
  if v_estado is not null and v_estado is distinct from v_actual then
    update trabajos set estado = v_estado where id = p_trabajo;
  end if;
end $$;

-- Crear un sobre con sus ítems. p: {nro_sobre, cliente_id, tipo, items:[{descripcion, tallerista_id,
--   presupuesto_hechura, presupuesto_moneda, presupuesto_metal, presupuesto_peso}]}
-- Devuelve {trabajo_id, items:[id,...]} (en el mismo orden) para subir las fotos.
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
    insert into items (trabajo_id, numero, descripcion, tallerista_id, estado,
      presupuesto_hechura, presupuesto_moneda, presupuesto_metal, presupuesto_peso)
    values (v_trab, n, nullif(trim(it->>'descripcion'),''), nullif(it->>'tallerista_id','')::bigint,
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

-- Agregar un ítem a un sobre que todavía no se facturó
create or replace function agregar_item(p_trabajo bigint, p_descripcion text, p_tallerista bigint default null) returns bigint
language plpgsql set search_path = public as $$
declare v_item bigint; v_tipo tipo_ingreso; v_estado estado_trabajo;
begin
  select tipo, estado into v_tipo, v_estado from trabajos where id = p_trabajo;
  if v_estado in ('facturado','entregado') then raise exception 'El sobre ya está facturado'; end if;
  insert into items (trabajo_id, numero, descripcion, tallerista_id, estado)
  values (p_trabajo, (select coalesce(max(numero),0)+1 from items where trabajo_id = p_trabajo), nullif(trim(p_descripcion),''), p_tallerista, 'taller')
  returning id into v_item;
  if p_tallerista is not null then
    insert into traspasos_taller (trabajo_id, item_id, tallerista_id) values (p_trabajo, v_item, p_tallerista);
  end if;
  perform sincronizar_sobre(p_trabajo);
  return v_item;
end $$;

-- Presupuesto del ítem: aceptado → taller · rechazado → listo (no se hace)
create or replace function responder_item(p_item bigint, p_aceptado boolean) returns void
language plpgsql set search_path = public as $$
declare v_trab bigint; v_tall bigint;
begin
  update items set presupuesto_respuesta = case when p_aceptado then 'aceptado' else 'rechazado' end,
    estado = case when p_aceptado then 'taller' else 'rechazado' end
  where id = p_item and estado = 'pendiente'
  returning trabajo_id, tallerista_id into v_trab, v_tall;
  if not found then raise exception 'El ítem no está pendiente'; end if;
  if p_aceptado and v_tall is not null then
    insert into traspasos_taller (trabajo_id, item_id, tallerista_id) values (v_trab, p_item, v_tall);
  end if;
  perform sincronizar_sobre(v_trab);
end $$;

-- Pasar el ítem a otro tallerista (o asignarle uno); la fecha queda registrada
create or replace function asignar_tallerista_item(p_item bigint, p_tallerista bigint, p_fecha date default null) returns void
language plpgsql set search_path = public as $$
declare v_trab bigint; v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
begin
  update items set tallerista_id = p_tallerista where id = p_item returning trabajo_id into v_trab;
  if not found then raise exception 'Ítem inexistente'; end if;
  update traspasos_taller set hasta = v_fecha where item_id = p_item and hasta is null;
  insert into traspasos_taller (trabajo_id, item_id, tallerista_id, fecha) values (v_trab, p_item, p_tallerista, v_fecha);
end $$;

-- Ítem terminado: registra lo pagado al tallerista (solo registro, no se factura)
create or replace function marcar_item_listo(p_item bigint, p_pago numeric, p_moneda moneda, p_oro18 numeric) returns void
language plpgsql set search_path = public as $$
declare v_trab bigint; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  update items set estado = 'listo' where id = p_item and estado = 'taller' returning trabajo_id into v_trab;
  if not found then raise exception 'El ítem no está en taller'; end if;
  update traspasos_taller set hasta = v_hoy, pago = p_pago,
    pago_moneda = case when p_pago is null then null else p_moneda end, pago_oro18 = p_oro18
  where id = (select id from traspasos_taller where item_id = p_item order by fecha desc, id desc limit 1);
  perform sincronizar_sobre(v_trab);
end $$;

-- Devolver un ítem terminado al taller
create or replace function devolver_item(p_item bigint, p_tallerista bigint) returns void
language plpgsql set search_path = public as $$
declare v_trab bigint; v_estado estado_trabajo;
begin
  select i.trabajo_id, t.estado into v_trab, v_estado from items i join trabajos t on t.id = i.trabajo_id where i.id = p_item;
  if v_estado in ('facturado','entregado') then raise exception 'El sobre ya está facturado'; end if;
  update items set estado = 'taller' where id = p_item and estado = 'listo';
  if not found then raise exception 'Solo se devuelve un ítem terminado'; end if;
  perform asignar_tallerista_item(p_item, p_tallerista);
  perform sincronizar_sobre(v_trab);
end $$;

revoke execute on function crear_sobre, agregar_item, responder_item, asignar_tallerista_item, marcar_item_listo, devolver_item, sincronizar_sobre from public, anon;
grant execute on function crear_sobre, agregar_item, responder_item, asignar_tallerista_item, marcar_item_listo, devolver_item, sincronizar_sobre to authenticated;
