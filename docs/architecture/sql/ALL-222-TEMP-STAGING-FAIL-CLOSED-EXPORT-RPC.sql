-- Staging-only canonical fail-closed inline export; no complete export authorization.
CREATE OR REPLACE FUNCTION public.v2_export_my_account_snapshot(p_expected_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid:=auth.uid();
 v_export jsonb;
begin
 if v_user is null or p_expected_user_id is distinct from v_user
   or not exists(select 1 from auth.users where id=v_user) then
   raise exception 'Active account ownership required for export' using errcode='42501';
 end if;
 if exists(select 1 from storage.buckets) then
   raise exception 'Account export needs Storage coverage before use' using errcode='42501';
 end if;
 if exists (
   select 1 from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid
      and a.attname='user_id' and a.attnum>0 and not a.attisdropped
   where n.nspname in ('public','allin_private') and c.relkind in ('r','p')
     and not (
       (n.nspname='public' and c.relname=any(array[
         'v2_profiles','v2_profile_settings','v2_onboarding_progress','v2_legal_acceptances'
       ]))
       or (n.nspname='allin_private' and c.relname=any(array[
         'v2_health_considerations','v2_profile_settings_actions','v2_onboarding_actions',
         'v2_account_deletion_requests','v2_account_deletion_execution_audit'
       ]))
     )
 ) then
   raise exception 'New personal data tables require export coverage' using errcode='42501';
 end if;

 select jsonb_build_object(
   'schema_version','v2-account-export-snapshot-v1',
   'exported_at',now(),
   'account', (select jsonb_build_object('id',u.id,'email',u.email,
       'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at)
     from auth.users u where u.id=v_user),
   'profile',(select to_jsonb(p) from public.v2_profiles p where p.user_id=v_user),
   'profile_settings',(select to_jsonb(s) from public.v2_profile_settings s where s.user_id=v_user),
   'onboarding_progress',(select to_jsonb(o) from public.v2_onboarding_progress o where o.user_id=v_user),
   'legal_acceptances',coalesce((select jsonb_agg(to_jsonb(l) order by l.accepted_at)
     from public.v2_legal_acceptances l where l.user_id=v_user),'[]'::jsonb),
   'health_considerations',(select to_jsonb(h) from allin_private.v2_health_considerations h where h.user_id=v_user),
   'profile_settings_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
     from allin_private.v2_profile_settings_actions a where a.user_id=v_user),'[]'::jsonb),
   'onboarding_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
     from allin_private.v2_onboarding_actions a where a.user_id=v_user),'[]'::jsonb),
   'deletion_request',(select to_jsonb(d) from allin_private.v2_account_deletion_requests d where d.user_id=v_user),
   'deletion_execution',(select to_jsonb(d) from allin_private.v2_account_deletion_execution_audit d where d.user_id=v_user)
 ) into v_export;
 if pg_catalog.octet_length(v_export::text) > 5000000 then
   raise exception 'Account snapshot exceeds inline limit; secure export required' using errcode='54000';
 end if;
 return v_export;
end;$function$
;
REVOKE ALL ON FUNCTION public.v2_export_my_account_snapshot(p_expected_user_id uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.v2_export_my_account_snapshot(p_expected_user_id uuid) TO authenticated;
