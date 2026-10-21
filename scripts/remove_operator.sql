-- ════════════════════════════════════════════════════════════════════
--  Rimozione operatore
--  • Rende nullable operator_id su diaries e medication_logs
--    (così i diari/log esistenti restano ma non referenziano più
--     un profilo eliminato)
--  • Crea RPC remove_operator: nullifica FK critiche, elimina il
--    profilo (cascade su turni, notifiche, ecc.) e rimuove l'utente
--    da auth.users per revocare completamente l'accesso.
--
--  Esegui una volta nel SQL Editor di Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. diaries.operator_id → nullable con SET NULL on delete ─────────────────

alter table public.diaries
  alter column operator_id drop not null;

-- Aggiunge la FK se non esiste (no-op se già presente con SET NULL)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
    where tc.table_name = 'diaries'
      and kcu.column_name = 'operator_id'
      and tc.constraint_type = 'FOREIGN KEY'
  ) then
    alter table public.diaries
      add constraint diaries_operator_id_fkey
        foreign key (operator_id) references public.profiles(id) on delete set null;
  end if;
end $$;

-- ─── 2. medication_logs.operator_id → nullable con SET NULL on delete ─────────

alter table public.medication_logs
  alter column operator_id drop not null;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
    where tc.table_name = 'medication_logs'
      and kcu.column_name = 'operator_id'
      and tc.constraint_type = 'FOREIGN KEY'
  ) then
    alter table public.medication_logs
      add constraint medication_logs_operator_id_fkey
        foreign key (operator_id) references public.profiles(id) on delete set null;
  else
    -- Ricrea con SET NULL se già esiste senza di esso
    alter table public.medication_logs
      drop constraint if exists medication_logs_operator_id_fkey;
    alter table public.medication_logs
      add constraint medication_logs_operator_id_fkey
        foreign key (operator_id) references public.profiles(id) on delete set null;
  end if;
end $$;

-- ─── 3. Funzione RPC remove_operator ──────────────────────────────────────────
--
--  Sicurezza:
--  • Solo un manager della stessa organizzazione può eliminare un operatore
--  • Non può eliminare se stesso
--  • Non può eliminare altri manager o admin_secondary
--
--  Cosa viene conservato:
--  • diaries  → operator_id impostato a NULL  (diario rimane visibile)
--  • medication_logs → operator_id impostato a NULL
--  • resident_documents.uploaded_by → già SET NULL per FK
--  • resident_appointments.assigned_operator_id → già SET NULL per FK
--  • resident_legal_records.created_by → già SET NULL per FK
--
--  Cosa viene eliminato a cascata (via profiles ON DELETE CASCADE):
--  • schedules, notifications, diary_comments, report_views,
--    report_edits, absences, scheduling_constraints

create or replace function public.remove_operator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role  text;
  v_caller_org   bigint;
  v_target_role  text;
  v_target_org   bigint;
begin
  -- ── Verifica chiamante ────────────────────────────────────────────────────
  select p.role, s.organization_id
    into v_caller_role, v_caller_org
    from public.profiles p
    join public.structures s on s.id = p.structure_id
   where p.id = auth.uid();

  if v_caller_role <> 'manager' then
    raise exception 'Non autorizzato: solo i manager possono rimuovere operatori.';
  end if;

  if auth.uid() = p_user_id then
    raise exception 'Non puoi eliminare il tuo stesso account.';
  end if;

  -- ── Verifica bersaglio ────────────────────────────────────────────────────
  select p.role, s.organization_id
    into v_target_role, v_target_org
    from public.profiles p
    join public.structures s on s.id = p.structure_id
   where p.id = p_user_id;

  if not found then
    raise exception 'Operatore non trovato.';
  end if;

  if v_target_org <> v_caller_org then
    raise exception 'Non autorizzato: l''operatore non appartiene alla tua organizzazione.';
  end if;

  if v_target_role not in ('operator', 'admin_secondary') then
    raise exception 'Non puoi eliminare un manager.';
  end if;

  -- ── 1. Preserva diari: nullifica operator_id ─────────────────────────────
  update public.diaries
     set operator_id = null
   where operator_id = p_user_id;

  -- ── 2. Preserva log farmaci: nullifica operator_id ───────────────────────
  update public.medication_logs
     set operator_id = null
   where operator_id = p_user_id;

  -- ── 3. Elimina il profilo (cascade su turni, notifiche, ecc.) ────────────
  delete from public.profiles where id = p_user_id;

  -- ── 4. Elimina da auth.users (revoca accesso all'applicazione) ───────────
  delete from auth.users where id = p_user_id;

end;
$$;

-- ─── 4. Policy: solo il chiamante autenticato può invocare la funzione ────────
-- (la funzione stessa verifica il ruolo; nessuna policy extra necessaria
--  perché è SECURITY DEFINER e verifica internamente)

-- Revoca EXECUTE a PUBLIC per sicurezza, garantisci solo agli authenticated
revoke execute on function public.remove_operator(uuid) from public;
grant  execute on function public.remove_operator(uuid) to authenticated;
