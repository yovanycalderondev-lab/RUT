-- ============================================================
-- R.U.T. (Rise Up Together) — schema.sql
-- Ejecuta este archivo completo en el SQL Editor de Supabase
-- (Proyecto > SQL Editor > New query > pega todo > Run)
-- ANTES de abrir el sitio, o el login y el dashboard no van a
-- funcionar (verás "relation ... does not exist" en la consola).
-- ============================================================

-- ---------- PROFILES ----------
-- Un perfil por usuario de auth.users. El código lo inserta a mano
-- en el signup (ver enviarAuth en script.js), no hay trigger automático.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  disponibilidad text,          -- 'manana' | 'tarde' | 'noche'
  premium boolean default false,
  github_usuario text,
  xp_total int default 0,
  linkedin_checklist jsonb default '[]'::jsonb,
  linkedin_url text
);

alter table profiles enable row level security;

create policy "Perfiles: cualquier autenticado puede leer"
  on profiles for select to authenticated using (true);

create policy "Perfiles: cada quien crea el suyo"
  on profiles for insert to authenticated with check (auth.uid() = id);

create policy "Perfiles: cada quien edita el suyo"
  on profiles for update to authenticated using (auth.uid() = id);


-- ---------- SQUADS ----------
create table if not exists squads (
  id uuid primary key default gen_random_uuid(),
  disponibilidad text,
  activo boolean default true,
  created_at timestamptz default now()
);

alter table squads enable row level security;

create policy "Squads: cualquier autenticado puede leer"
  on squads for select to authenticated using (true);

create policy "Squads: cualquier autenticado puede crear"
  on squads for insert to authenticated with check (true);


-- ---------- SQUAD_MEMBERS ----------
-- MVP: el matchmaking (unirseOCrearSquad en script.js) recorre squads
-- abiertos desde el cliente. Para producción a mayor escala, mueve esa
-- lógica a una función RPC de Postgres para evitar condiciones de carrera
-- si dos personas se unen al mismo tiempo al último cupo.
create table if not exists squad_members (
  squad_id uuid references squads(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  orden int default 0,
  primary key (squad_id, user_id),
  unique (user_id)  -- una persona pertenece a un solo squad a la vez
);

alter table squad_members enable row level security;

create policy "Squad_members: cualquier autenticado puede leer"
  on squad_members for select to authenticated using (true);

create policy "Squad_members: cada quien se agrega a sí mismo"
  on squad_members for insert to authenticated with check (auth.uid() = user_id);


-- ---------- SQUAD_MESSAGES (chat) ----------
create table if not exists squad_messages (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid references squads(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  contenido text not null,
  created_at timestamptz default now()
);

alter table squad_messages enable row level security;

create policy "Mensajes: miembros del squad pueden leer"
  on squad_messages for select to authenticated using (
    exists (select 1 from squad_members sm where sm.squad_id = squad_messages.squad_id and sm.user_id = auth.uid())
  );

create policy "Mensajes: miembros del squad pueden escribir"
  on squad_messages for insert to authenticated with check (
    auth.uid() = user_id
    and exists (select 1 from squad_members sm where sm.squad_id = squad_messages.squad_id and sm.user_id = auth.uid())
  );

-- Habilita Realtime para el chat en vivo
alter publication supabase_realtime add table squad_messages;


-- ---------- EVIDENCE_LOGS ----------
create table if not exists evidence_logs (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid references squads(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  descripcion text not null,
  enlace text,
  verificado_github boolean,
  fecha date default current_date,
  created_at timestamptz default now()
);

alter table evidence_logs enable row level security;

create policy "Evidencia: miembros del squad pueden leer"
  on evidence_logs for select to authenticated using (
    exists (select 1 from squad_members sm where sm.squad_id = evidence_logs.squad_id and sm.user_id = auth.uid())
  );

create policy "Evidencia: cada quien registra la suya"
  on evidence_logs for insert to authenticated with check (auth.uid() = user_id);


-- ---------- LESSON_PROGRESS ----------
create table if not exists lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  leccion_id text not null,
  created_at timestamptz default now(),
  unique (user_id, leccion_id)
);

alter table lesson_progress enable row level security;

create policy "Progreso: cada quien lee el suyo"
  on lesson_progress for select to authenticated using (auth.uid() = user_id);

create policy "Progreso: cada quien registra el suyo"
  on lesson_progress for insert to authenticated with check (auth.uid() = user_id);


-- ---------- SQUAD_EDITOR_DOCS (editor colaborativo) ----------
create table if not exists squad_editor_docs (
  squad_id uuid primary key references squads(id) on delete cascade,
  contenido text default '',
  updated_at timestamptz default now()
);

alter table squad_editor_docs enable row level security;

create policy "Editor: miembros del squad pueden leer"
  on squad_editor_docs for select to authenticated using (
    exists (select 1 from squad_members sm where sm.squad_id = squad_editor_docs.squad_id and sm.user_id = auth.uid())
  );

create policy "Editor: miembros del squad pueden escribir"
  on squad_editor_docs for insert to authenticated with check (
    exists (select 1 from squad_members sm where sm.squad_id = squad_editor_docs.squad_id and sm.user_id = auth.uid())
  );

create policy "Editor: miembros del squad pueden actualizar"
  on squad_editor_docs for update to authenticated using (
    exists (select 1 from squad_members sm where sm.squad_id = squad_editor_docs.squad_id and sm.user_id = auth.uid())
  );

-- ============================================================
-- NOTA: La videollamada (WebRTC) no necesita tabla — usa un canal
-- efímero de Supabase Realtime (call-{squadId}), no requiere nada
-- de este archivo.
-- NOTA: Ve a Authentication > Providers en Supabase y confirma que
-- "Email" esté activo. Si quieres probar sin verificar correo,
-- desactiva "Confirm email" en Authentication > Settings.
-- ============================================================
