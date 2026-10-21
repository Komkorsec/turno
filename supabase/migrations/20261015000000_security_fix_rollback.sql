-- =============================================================================
-- Turno – Security Fix ROLLBACK
-- Da eseguire SOLO se la migrazione va revertita.
-- ATTENZIONE: ripristina le vulnerabilità. Solo per emergenza.
-- =============================================================================

BEGIN;

-- Ripristina i privilegi PUBLIC sulle funzioni SECURITY DEFINER
-- (torna allo stato pre-fix, accessibili da anon via RPC)

GRANT EXECUTE ON FUNCTION public.admin_delete_organization(bigint)            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_structure(bigint)               TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid)                      TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_users_with_email()                 TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_resident_data(bigint)             TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_appointment_reminders()                TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text)                     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_expiring_document_notifications()      TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_missed_medications()                   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_structure_operators(bigint)            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_structure(text)                       TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_structure(text,text,text,integer)     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_all_notifications()                   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_archived_employee(bigint)             TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_archived_operator(uuid)               TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_approved_absences(uuid[])                TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archived_employees(integer)              TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archived_team_members(integer)           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_absences(uuid)                    TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_month_schedules(bigint,date,date)        TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_absences()                           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_prev_weekend_worked(uuid[],date,date)    TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profiles_by_ids(uuid[])                  TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profiles_names(uuid[])                   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_structure_diaries(bigint,timestamptz,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_structure_manager_ids(bigint)            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_structure_members(bigint)                TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_members(integer)                    TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_structure_ids(uuid)                 TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_week_schedules(bigint,date)              TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user()                            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.hard_delete_resident(text)                   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_same_structure_as_resident(bigint)        TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_add_absence(uuid,date,date,text)     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_delete_absences(bigint[])            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read()                TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid)                 TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_accessible_resident(bigint)               TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_accessible_storage_structure(bigint)      TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_extra_structure_ids()                     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_org_owns_structure(bigint)                TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_organization_id()                         TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_role()                                    TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_structure_id()                            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_absence_group(uuid)                   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_absence_request()                     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_absence_status_change()               TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_new_appointment()                     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_new_diary()                           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_new_document()                        TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_urgent_diary()                        TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_week_schedules(bigint,date,date)     TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_notifications()                    TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_operator(uuid)                        TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_operator_constraints(uuid,integer,integer,text,text,text,jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_weekend_off(uuid[],date)                 TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_delete_auth_user()                      TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminate_employment(uuid,integer,date,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_absence_status(bigint[],text)         TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_operator_contract(uuid,integer,integer,text,text,text,jsonb) TO PUBLIC;

-- Ripristina le RLS policy {public}
DROP POLICY IF EXISTS "manager can delete diaries in own structure" ON public.diaries;
CREATE POLICY "manager can delete diaries in own structure"
  ON public.diaries FOR DELETE TO public
  USING (my_organization_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM structures s WHERE s.id = diaries.structure_id AND s.organization_id = my_organization_id()
  ));

DROP POLICY IF EXISTS "members_insert_logs" ON public.medication_logs;
DROP POLICY IF EXISTS "members_select_logs" ON public.medication_logs;
CREATE POLICY "members_insert_logs"  ON public.medication_logs FOR INSERT TO public WITH CHECK (is_same_structure_as_resident(resident_id));
CREATE POLICY "members_select_logs"  ON public.medication_logs FOR SELECT TO public USING  (is_same_structure_as_resident(resident_id));

DROP POLICY IF EXISTS "members_insert_medications" ON public.resident_medications;
DROP POLICY IF EXISTS "members_select_medications" ON public.resident_medications;
DROP POLICY IF EXISTS "members_update_medications" ON public.resident_medications;
CREATE POLICY "members_insert_medications" ON public.resident_medications FOR INSERT TO public WITH CHECK (is_same_structure_as_resident(resident_id));
CREATE POLICY "members_select_medications" ON public.resident_medications FOR SELECT TO public USING  (is_same_structure_as_resident(resident_id));
CREATE POLICY "members_update_medications" ON public.resident_medications FOR UPDATE TO public USING (is_same_structure_as_resident(resident_id)) WITH CHECK (is_same_structure_as_resident(resident_id));

DROP POLICY IF EXISTS "notif_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notif_update_own" ON public.notifications;
CREATE POLICY "notif_select_own" ON public.notifications FOR SELECT TO public USING (user_id = auth.uid());
CREATE POLICY "notif_update_own" ON public.notifications FOR UPDATE TO public USING (user_id = auth.uid());

-- NOTA: il rollback delle funzioni (corpi) richiede di ri-applicare i file SQL
-- originali in scripts/. Le versioni vulnerabili sono:
--   scripts/admin_delete_user.sql
--   scripts/remove_operator.sql
--   scripts/fix_admin_delete_structure_v2.sql
--   scripts/admin_delete_organization.sql
-- ecc.

COMMIT;
