# 🛒 Mercado Familiar — Guía de despliegue

## 1. Supabase
1. Entra a https://supabase.com → **New project** (anota la contraseña, elige región cercana).
2. Menú **SQL Editor → New query**, pega todo `supabase.sql` y pulsa **Run**.
   (Esto crea las tablas, activa Realtime y las políticas.)
3. Menú **Project Settings → API**: copia **Project URL** y la clave **anon public**.
4. (Opcional) En **Database → Replication** verifica que `lista_compra_activa` aparezca en `supabase_realtime`.

## 2. GitHub
1. Crea un repositorio nuevo en https://github.com/new.
2. Sube esta carpeta:
   git init && git add . && git commit -m "app" && git branch -M main
   git remote add origin https://github.com/TU_USUARIO/mercado-familiar.git && git push -u origin main

## 3. Netlify
1. https://app.netlify.com → **Add new site → Import an existing project → GitHub** y elige el repo.
2. Netlify lee `netlify.toml` (build: `npm run build`, publish: `dist`).
3. Antes de desplegar, **Site configuration → Environment variables** y añade:
   - `VITE_SUPABASE_URL` = tu Project URL
   - `VITE_SUPABASE_ANON_KEY` = tu clave anon public
4. **Deploy**. Cada `git push` se publica solo.

## 4. Compartir e instalar
Envía el link `https://tu-sitio.netlify.app` a la familia.
- Android/Chrome: menú ⋮ → **Instalar aplicación**.
- iPhone/Safari: Compartir → **Añadir a pantalla de inicio**.
Cada persona escribe su nombre la primera vez y acepta las notificaciones.

## Desarrollo local
cp .env.example .env  (rellena claves) → npm install → npm run dev

## Notas
- Sin login: quien tenga el link puede editar. Para más privacidad añade Supabase Auth y ajusta las políticas RLS.
- Las alertas funcionan con la app abierta (aviso en pantalla + vibración + notificación local). Notificaciones push con la app cerrada requieren Web Push (siguiente paso).
