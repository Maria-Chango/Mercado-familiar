-- Ejecutar en Supabase > SQL Editor
create extension if not exists "pgcrypto";

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creado_en timestamptz default now()
);

create table productos_inventario (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null default 'Otros',
  cantidad numeric not null default 1,      -- cantidad mayorista semestral
  unidad text not null default 'unidades',  -- fundas, libras, kg...
  ultimo_precio numeric not null default 0, -- precio unitario histórico
  creado_en timestamptz default now()
);

create table lista_compra_activa (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos_inventario(id) on delete cascade,
  cantidad numeric not null default 1,
  precio_real numeric,                      -- precio cobrado hoy en el puesto
  comprado boolean not null default false,
  reportado_por uuid references usuarios(id),
  comprado_por uuid references usuarios(id),
  creado_en timestamptz default now()
);
-- Evita duplicar un producto pendiente
create unique index una_pendiente_por_producto on lista_compra_activa(producto_id) where comprado = false;

-- Realtime
alter table lista_compra_activa replica identity full;
alter table productos_inventario replica identity full;
alter publication supabase_realtime add table lista_compra_activa, productos_inventario;

-- Seguridad simple (app familiar sin login): acceso con la clave anon.
-- Para más privacidad, añade Supabase Auth y restringe las políticas.
alter table usuarios enable row level security;
alter table productos_inventario enable row level security;
alter table lista_compra_activa enable row level security;
create policy "familia" on usuarios for all using (true) with check (true);
create policy "familia" on productos_inventario for all using (true) with check (true);
create policy "familia" on lista_compra_activa for all using (true) with check (true);
