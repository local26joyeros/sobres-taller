-- Alerta de 5 días: prórroga por sobre y "desde cuándo" está en su estado actual
alter table trabajos add column if not exists prorroga_hasta date;
comment on column trabajos.prorroga_hasta is 'Prórroga dada al tallerista: el sobre no se marca en rojo hasta el día siguiente a esta fecha';

create or replace view vista_trabajos as
 SELECT t.id, t.nro_sobre, t.cliente_id, t.tipo, t.descripcion, t.foto_path, t.estado, t.tallerista_id, t.ingresado_en,
    t.presupuesto_hechura, t.presupuesto_moneda, t.presupuesto_metal, t.presupuesto_respuesta, t.presupuesto_respondido_en,
    t.factura_id, t.hechura, t.hechura_moneda, t.metal, t.peso, t.peso_fino, t.facturado_en, t.entregado_en,
    c.nombre AS cliente, ta.nombre AS tallerista,
    CASE WHEN t.metal = 'oro'::metal THEN t.peso ELSE NULL::numeric END AS peso_oro_18k,
    t.presupuesto_peso,
    t.prorroga_hasta,
    coalesce((select max(h.cambiado_en) from historial_estados h where h.trabajo_id = t.id), t.ingresado_en) AS estado_desde
   FROM trabajos t
     JOIN clientes c ON c.id = t.cliente_id
     LEFT JOIN talleristas ta ON ta.id = t.tallerista_id;
alter view vista_trabajos set (security_invoker = on);

-- Oro fino facturado con un solo decimal (también lo que se carga en la cuenta del cliente)
alter table factura_lineas alter column peso_fino set expression as (case when metal = 'oro' then round(peso * 0.825, 1) else peso end);
