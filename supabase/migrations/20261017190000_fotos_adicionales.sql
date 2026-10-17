-- Fotos adicionales de cada sobre (la principal sigue en trabajos.foto_path)
create table trabajo_fotos (
  id bigint generated always as identity primary key,
  trabajo_id bigint not null references trabajos(id) on delete cascade,
  path text not null,
  creado_en timestamptz not null default now()
);
create index on trabajo_fotos (trabajo_id);
alter table trabajo_fotos enable row level security;
create policy "acceso autenticado" on trabajo_fotos for all to authenticated using (true) with check (true);
create policy "solo autorizados" on trabajo_fotos as restrictive for all to authenticated using ((select es_autorizado())) with check ((select es_autorizado()));
