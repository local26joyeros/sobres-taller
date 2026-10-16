alter table trabajos add column presupuesto_peso numeric(10,3);

-- Historial de talleres por los que pasa cada sobre
create table traspasos_taller (
  id bigint generated always as identity primary key,
  trabajo_id bigint not null references trabajos(id) on delete cascade,
  tallerista_id bigint not null references talleristas(id),
  fecha date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  creado_en timestamptz not null default now()
);
create index on traspasos_taller (trabajo_id);
alter table traspasos_taller enable row level security;
create policy "acceso autenticado" on traspasos_taller for all to authenticated using (true) with check (true);
create policy "solo autorizados" on traspasos_taller as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));

-- Reglas de estado nuevas:
--  Presupuesto: ingresa directo en Pendiente (esperando_confirmacion)
--  Pendiente → Aceptado: En taller · Rechazado: Listo para facturar
create or replace function validar_estado() returns trigger language plpgsql
set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not (
      (new.tipo = 'presupuesto' and new.estado in ('presupuesto','esperando_confirmacion')) or
      (new.tipo in ('taller','trabajo_nuevo') and new.estado = 'taller')
    ) then
      raise exception 'Estado inicial inválido para el tipo %', new.tipo;
    end if;
    insert into historial_estados (trabajo_id, estado_anterior, estado_nuevo) values (new.id, null, new.estado);
    if new.tallerista_id is not null and new.estado = 'taller' then
      insert into traspasos_taller (trabajo_id, tallerista_id) values (new.id, new.tallerista_id);
    end if;
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'presupuesto'            and new.estado = 'esperando_confirmacion') or
      (old.estado = 'esperando_confirmacion' and new.estado in ('taller','listo_para_facturar','rechazado')) or
      (old.estado = 'taller'                 and new.estado = 'listo_para_facturar') or
      (old.estado = 'listo_para_facturar'    and new.estado in ('facturado','taller')) or
      (old.estado = 'facturado'              and new.estado = 'entregado') or
      (old.estado = 'rechazado'              and new.estado in ('entregado','listo_para_facturar'))
    ) then
      raise exception 'No se puede pasar de "%" a "%"', old.estado, new.estado;
    end if;
    if new.estado = 'facturado' and new.factura_id is null then
      raise exception 'Para facturar usá la pantalla de facturación';
    end if;
    if new.estado = 'entregado' then new.entregado_en := now(); end if;
    insert into historial_estados (trabajo_id, estado_anterior, estado_nuevo) values (new.id, old.estado, new.estado);
  end if;
  return new;
end $$;

-- Pasar el sobre a un tallerista (primera asignación o traspaso), con fecha
create or replace function asignar_tallerista(p_trabajo bigint, p_tallerista bigint, p_fecha date default null)
returns void language plpgsql set search_path = public as $$
begin
  update trabajos set tallerista_id = p_tallerista where id = p_trabajo;
  if not found then raise exception 'Sobre inexistente'; end if;
  insert into traspasos_taller (trabajo_id, tallerista_id, fecha)
  values (p_trabajo, p_tallerista, coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date));
end $$;

-- Pendiente: aceptado → En taller (con datos precargados para facturar); rechazado → Listo para facturar
create or replace function responder_presupuesto(p_trabajo bigint, p_aceptado boolean, p_tallerista bigint default null)
returns void language plpgsql set search_path = public as $$
declare v_tall bigint;
begin
  update trabajos set
    presupuesto_respuesta = case when p_aceptado then 'aceptado' else 'rechazado' end,
    presupuesto_respondido_en = now(),
    estado = case when p_aceptado then 'taller'::estado_trabajo else 'listo_para_facturar'::estado_trabajo end,
    tallerista_id = coalesce(p_tallerista, tallerista_id),
    hechura = case when p_aceptado then presupuesto_hechura else hechura end,
    hechura_moneda = case when p_aceptado then presupuesto_moneda else hechura_moneda end,
    metal = case when p_aceptado then presupuesto_metal else metal end,
    peso = case when p_aceptado then presupuesto_peso else peso end
  where id = p_trabajo and estado = 'esperando_confirmacion'
  returning tallerista_id into v_tall;
  if not found then raise exception 'El sobre no está pendiente'; end if;
  if p_aceptado and v_tall is not null then
    insert into traspasos_taller (trabajo_id, tallerista_id) values (p_trabajo, v_tall);
  end if;
end $$;

revoke execute on function asignar_tallerista from public, anon;
grant execute on function asignar_tallerista to authenticated;

create or replace view vista_trabajos with (security_invoker = on) as
select t.id, t.nro_sobre, t.cliente_id, t.tipo, t.descripcion, t.foto_path, t.estado, t.tallerista_id, t.ingresado_en,
  t.presupuesto_hechura, t.presupuesto_moneda, t.presupuesto_metal, t.presupuesto_respuesta, t.presupuesto_respondido_en,
  t.factura_id, t.hechura, t.hechura_moneda, t.metal, t.peso, t.peso_fino, t.facturado_en, t.entregado_en,
  c.nombre as cliente, ta.nombre as tallerista,
  case when t.metal = 'oro' then t.peso end as peso_oro_18k,
  t.presupuesto_peso
from trabajos t
join clientes c on c.id = t.cliente_id
left join talleristas ta on ta.id = t.tallerista_id;
