-- ═══════════════════════════════════════════════════════
--  TURNO — Schema SaaS: strutture, codici invito, trigger
-- ═══════════════════════════════════════════════════════

-- 1. Aggiorna tabella structures (aggiunge address e created_at)
alter table public.structures
  add column if not exists address    text,
  add column if not exists created_at timestamptz not null default now();

-- 2. Tabella codici invito
create table if not exists public.invitation_codes (
  id           bigint      primary key generated always as identity,
  code         text        not null unique,
  role         text        not null check (role in ('operator', 'manager')),
  structure_id smallint    references public.structures(id),
  is_used      boolean     not null default false,
  created_at   timestamptz not null default now(),
  -- i codici operator devono puntare a una struttura esistente
  constraint operator_code_needs_structure
    check (role = 'manager' or structure_id is not null)
);

-- 3. RLS per invitation_codes
--    Lettura permessa anche agli utenti non autenticati (necessario per la
--    validazione del codice prima del signUp)
alter table public.invitation_codes enable row level security;

create policy "codes_read" on public.invitation_codes
  for select to anon, authenticated
  using (true);

-- 4. Trigger handle_new_user — versione aggiornata
--    Gestisce sia il flusso con codice invito (auto-registrazione)
--    sia il flusso admin (seed script / dashboard Supabase)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_code     text;
  v_code_row public.invitation_codes%rowtype;
  v_sid      smallint;
  v_role     text;
  v_name     text;
  v_strname  text;
begin
  v_name    := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_code    := new.raw_user_meta_data->>'invitation_code';
  v_strname := new.raw_user_meta_data->>'structure_name';

  if v_code is not null then
    -- ── Flusso con codice invito ──────────────────────────────────────
    select * into v_code_row
      from public.invitation_codes
     where code = v_code and is_used = false;

    if not found then
      raise exception 'Codice invito non valido o già utilizzato.';
    end if;

    v_role := v_code_row.role;

    if v_role = 'manager' then
      -- Crea la struttura al volo
      insert into public.structures (name)
        values (coalesce(nullif(trim(v_strname), ''), 'Struttura di ' || v_name))
        returning id into v_sid;
    else
      -- Usa la struttura già associata al codice
      v_sid := v_code_row.structure_id;
    end if;

    -- Marca il codice come usato (atomico con la creazione del profilo)
    update public.invitation_codes set is_used = true where code = v_code;

  else
    -- ── Flusso admin (seed script / creazione manuale da dashboard) ───
    v_role := coalesce(new.raw_user_meta_data->>'role', 'operator');
    v_sid  := (new.raw_user_meta_data->>'structure_id')::smallint;
  end if;

  insert into public.profiles (id, full_name, role, structure_id)
    values (new.id, v_name, v_role, v_sid);

  return new;
end;
$$;

-- 5. Codici invito di test (usali per provare la registrazione)
insert into public.invitation_codes (code, role, structure_id) values
  ('TURNO-MGR-001', 'manager',  null),
  ('TURNO-MGR-002', 'manager',  null),
  ('TURNO-OPR-001', 'operator', 1),
  ('TURNO-OPR-002', 'operator', 1),
  ('TURNO-OPR-003', 'operator', 2)
on conflict (code) do nothing;
