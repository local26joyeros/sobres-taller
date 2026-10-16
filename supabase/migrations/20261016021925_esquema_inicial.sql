create type tipo_ingreso as enum ('presupuesto','taller','trabajo_nuevo');
create type estado_trabajo as enum ('presupuesto','esperando_confirmacion','rechazado','taller','listo_para_facturar','facturado','entregado');
create type moneda as enum ('ARS','USD');
create type metal as enum ('plata','oro','platino');
create type tipo_movimiento as enum ('apertura','facturacion','pago','entrega_metal','ajuste');

create table clientes (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  telefono text,
  notas text,
  creado_en timestamptz not null default now()
);

create table talleristas (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table facturas (
  id bigint generated always as identity primary key,
  facturado_en timestamptz not null default now(),
  notas text
);

create table trabajos (
  id bigint generated always as identity primary key,
  nro_sobre text not null unique,
  cliente_id bigint not null references clientes(id),
  tipo tipo_ingreso not null,
  descripcion text,
  foto_path text,
  estado estado_trabajo not null,
  tallerista_id bigint references talleristas(id),
  ingresado_en timestamptz not null default now(),
  -- presupuesto
  presupuesto_hechura numeric(14,2),
  presupuesto_moneda moneda,
  presupuesto_metal metal,
  presupuesto_respuesta text check (presupuesto_respuesta in ('aceptado','rechazado')),
  presupuesto_respondido_en timestamptz,
  -- facturación
  factura_id bigint references facturas(id),
  hechura numeric(14,2),
  hechura_moneda moneda,
  metal metal,
  peso numeric(10,3),            -- oro: 18k; plata/platino: fino
  peso_fino numeric(10,3) generated always as (
    case when metal = 'oro' then round(peso * 0.825, 3) else peso end
  ) stored,
  facturado_en timestamptz,
  entregado_en timestamptz
);
create index on trabajos (estado);
create index on trabajos (cliente_id);
create index on trabajos (factura_id);

create table historial_estados (
  id bigint generated always as identity primary key,
  trabajo_id bigint not null references trabajos(id) on delete cascade,
  estado_anterior estado_trabajo,
  estado_nuevo estado_trabajo not null,
  cambiado_en timestamptz not null default now()
);
create index on historial_estados (trabajo_id);

-- Cuenta corriente: positivo = el cliente debe; negativo = a favor del cliente
create table movimientos_cuenta (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references clientes(id),
  fecha timestamptz not null default now(),
  tipo tipo_movimiento not null,
  trabajo_id bigint references trabajos(id),
  factura_id bigint references facturas(id),
  hechuras numeric(14,2) not null default 0,   -- pesos
  dolares numeric(14,2) not null default 0,
  oro_fino numeric(10,3) not null default 0,   -- gramos
  granalla numeric(10,3) not null default 0,   -- gramos
  platino numeric(10,3) not null default 0,    -- gramos
  plata_fina numeric(10,3) not null default 0, -- gramos
  nota text
);
create index on movimientos_cuenta (cliente_id);

-- ===== Reglas de estado =====
create or replace function validar_estado() returns trigger language plpgsql
set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not (
      (new.tipo = 'presupuesto' and new.estado = 'presupuesto') or
      (new.tipo in ('taller','trabajo_nuevo') and new.estado = 'taller')
    ) then
      raise exception 'Estado inicial inválido para el tipo %', new.tipo;
    end if;
    insert into historial_estados (trabajo_id, estado_anterior, estado_nuevo) values (new.id, null, new.estado);
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'presupuesto'            and new.estado = 'esperando_confirmacion') or
      (old.estado = 'esperando_confirmacion' and new.estado in ('taller','rechazado','presupuesto')) or
      (old.estado = 'taller'                 and new.estado = 'listo_para_facturar') or
      (old.estado = 'listo_para_facturar'    and new.estado in ('facturado','taller')) or
      (old.estado = 'facturado'              and new.estado = 'entregado') or
      (old.estado = 'rechazado'              and new.estado = 'entregado')
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

create trigger trg_validar_estado_ins after insert on trabajos for each row execute function validar_estado();
create trigger trg_validar_estado_upd before update on trabajos for each row execute function validar_estado();

-- ===== Acciones =====
create or replace function cargar_presupuesto(p_trabajo bigint, p_hechura numeric, p_moneda moneda, p_metal metal)
returns void language plpgsql set search_path = public as $$
begin
  update trabajos set presupuesto_hechura = p_hechura, presupuesto_moneda = p_moneda,
    presupuesto_metal = p_metal, estado = 'esperando_confirmacion'
  where id = p_trabajo and estado = 'presupuesto';
  if not found then raise exception 'El trabajo no está en estado Presupuesto'; end if;
end $$;

create or replace function responder_presupuesto(p_trabajo bigint, p_aceptado boolean, p_tallerista bigint default null)
returns void language plpgsql set search_path = public as $$
begin
  update trabajos set
    presupuesto_respuesta = case when p_aceptado then 'aceptado' else 'rechazado' end,
    presupuesto_respondido_en = now(),
    estado = case when p_aceptado then 'taller'::estado_trabajo else 'rechazado'::estado_trabajo end,
    tallerista_id = coalesce(p_tallerista, tallerista_id),
    -- precargar datos de facturación desde el presupuesto
    hechura = case when p_aceptado then presupuesto_hechura else hechura end,
    hechura_moneda = case when p_aceptado then presupuesto_moneda else hechura_moneda end,
    metal = case when p_aceptado then presupuesto_metal else metal end
  where id = p_trabajo and estado = 'esperando_confirmacion';
  if not found then raise exception 'El trabajo no está esperando confirmación'; end if;
end $$;

-- p_items: [{"trabajo_id":1,"hechura":1000,"hechura_moneda":"ARS","metal":"oro","peso":3.2}, ...]
create or replace function facturar_lote(p_items jsonb, p_notas text default null)
returns bigint language plpgsql set search_path = public as $$
declare
  v_factura bigint;
  it jsonb;
  t trabajos;
begin
  if jsonb_array_length(p_items) = 0 then raise exception 'No hay sobres para facturar'; end if;
  insert into facturas (notas) values (p_notas) returning id into v_factura;

  for it in select * from jsonb_array_elements(p_items) loop
    update trabajos set
      hechura = (it->>'hechura')::numeric,
      hechura_moneda = (it->>'hechura_moneda')::moneda,
      metal = nullif(it->>'metal','')::metal,
      peso = nullif(it->>'peso','')::numeric,
      factura_id = v_factura,
      facturado_en = now(),
      estado = 'facturado'
    where id = (it->>'trabajo_id')::bigint and estado = 'listo_para_facturar'
    returning * into t;
    if not found then raise exception 'El trabajo % no está listo para facturar', it->>'trabajo_id'; end if;

    insert into movimientos_cuenta (cliente_id, tipo, trabajo_id, factura_id, hechuras, dolares, oro_fino, platino, plata_fina, nota)
    values (t.cliente_id, 'facturacion', t.id, v_factura,
      case when t.hechura_moneda = 'ARS' then coalesce(t.hechura,0) else 0 end,
      case when t.hechura_moneda = 'USD' then coalesce(t.hechura,0) else 0 end,
      case when t.metal = 'oro' then coalesce(t.peso_fino,0) else 0 end,
      case when t.metal = 'platino' then coalesce(t.peso_fino,0) else 0 end,
      case when t.metal = 'plata' then coalesce(t.peso_fino,0) else 0 end,
      'Sobre ' || t.nro_sobre);
  end loop;
  return v_factura;
end $$;

-- ===== Vistas =====
create view saldos_clientes with (security_invoker = on) as
select c.id as cliente_id, c.nombre,
  coalesce(sum(m.hechuras),0) as hechuras,
  coalesce(sum(m.dolares),0) as dolares,
  coalesce(sum(m.oro_fino),0) as oro_fino,
  coalesce(sum(m.granalla),0) as granalla,
  coalesce(sum(m.platino),0) as platino,
  coalesce(sum(m.plata_fina),0) as plata_fina
from clientes c left join movimientos_cuenta m on m.cliente_id = c.id
group by c.id, c.nombre;

create view vista_trabajos with (security_invoker = on) as
select t.*, c.nombre as cliente, ta.nombre as tallerista,
  case when t.metal = 'oro' then t.peso end as peso_oro_18k
from trabajos t
join clientes c on c.id = t.cliente_id
left join talleristas ta on ta.id = t.tallerista_id;

-- ===== Seguridad =====
alter table clientes enable row level security;
alter table talleristas enable row level security;
alter table facturas enable row level security;
alter table trabajos enable row level security;
alter table historial_estados enable row level security;
alter table movimientos_cuenta enable row level security;

create policy "acceso autenticado" on clientes for all to authenticated using (true) with check (true);
create policy "acceso autenticado" on talleristas for all to authenticated using (true) with check (true);
create policy "acceso autenticado" on facturas for all to authenticated using (true) with check (true);
create policy "acceso autenticado" on trabajos for all to authenticated using (true) with check (true);
create policy "acceso autenticado" on historial_estados for all to authenticated using (true) with check (true);
create policy "acceso autenticado" on movimientos_cuenta for all to authenticated using (true) with check (true);

revoke execute on function cargar_presupuesto, responder_presupuesto, facturar_lote from public, anon;
grant execute on function cargar_presupuesto, responder_presupuesto, facturar_lote to authenticated;

-- ===== Fotos =====
insert into storage.buckets (id, name, public) values ('fotos','fotos', false);
create policy "fotos autenticado leer" on storage.objects for select to authenticated using (bucket_id = 'fotos');
create policy "fotos autenticado subir" on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
create policy "fotos autenticado modificar" on storage.objects for update to authenticated using (bucket_id = 'fotos');
create policy "fotos autenticado borrar" on storage.objects for delete to authenticated using (bucket_id = 'fotos');
