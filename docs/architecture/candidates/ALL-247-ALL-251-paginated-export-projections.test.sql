-- Run only in disposable BEGIN/ROLLBACK. After Food Log and Hydration SQL candidates, apply this inventory MOCK then the canonical page function extracted from docs/architecture/sql/V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql. Does not test the actual ALL-251 session gate.

-- Disposable acceptance mock for inventory: this is NOT the canonical authorization gate.
create function public.v2_account_export_inventory_review_candidate(
 p_owner uuid,p_session uuid,p_request uuid
) returns jsonb language plpgsql security definer set search_path=''
as $mock$
begin
 if p_owner is distinct from auth.uid() or p_session is null or p_request is null then
   raise exception 'Mock rejects foreign owner' using errcode='42501';
 end if;
 return pg_catalog.jsonb_build_object('snapshotId','test-only-snapshot',
 'collections',pg_catalog.jsonb_build_array('public.v2_food_log_entries',
 'public.v2_hydration_events','allin_private.v2_food_log_write_actions',
 'allin_private.v2_hydration_actions'));
end
$mock$;


insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','export-247-a@example.invalid','',now(),now(),now()),
('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','export-247-b@example.invalid','',now(),now(),now());
grant execute on function public.v2_account_export_page_review_candidate(uuid,uuid,uuid,text,text,integer) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare p jsonb; v uuid:='11111111-1111-4111-8111-111111111111';
 s uuid:='33333333-3333-4333-8333-333333333333';
 r uuid:='44444444-4444-4444-8444-444444444444';
begin
 perform public.v2_food_log_add_manual(v,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 '2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Test',1,'serving',100,'user_entered');
 perform public.v2_food_log_mutate_manual(v,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'delete');
 perform public.v2_hydration_mutate_manual(v,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 'add',null,'2026-11-12 19:00+00','2026-11-12','America/Chicago','refill',500,'ml');
 p:=public.v2_account_export_page_review_candidate(v,s,r,'public.v2_food_log_entries',null,2);
 if pg_catalog.jsonb_array_length(p->'rows')<>1 or p#>>'{rows,0,deleted_at}' is null
 then raise exception 'Missing Food tombstone: %',p; end if;
 p:=public.v2_account_export_page_review_candidate(v,s,r,'public.v2_hydration_events',null,2);
 if p#>>'{rows,0,event_kind}' <> 'refill' then raise exception 'Lost hydration refill: %',p; end if;
 p:=public.v2_account_export_page_review_candidate(v,s,r,'allin_private.v2_food_log_write_actions',null,2);
 if pg_catalog.jsonb_array_length(p->'rows')<>2 or p::text like '%request_fingerprint%'
 then raise exception 'Food actions missing or fingerprint leaked: %',p; end if;
 p:=public.v2_account_export_page_review_candidate(v,s,r,'allin_private.v2_hydration_actions',null,2);
 if pg_catalog.jsonb_array_length(p->'rows')<>1 or p::text like '%request_fingerprint%'
 then raise exception 'Hydration action leak: %',p; end if;
 begin
  perform public.v2_account_export_page_review_candidate(v,s,r,'unapproved.collection',null,2);
  raise exception 'Unapproved collection accepted';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.v2_account_export_page_review_candidate('22222222-2222-4222-8222-222222222222',s,r,
  'public.v2_food_log_entries',null,2);
  raise exception 'Wrong-owner page accepted';
 exception when sqlstate '42501' then null; end;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 p:=public.v2_account_export_page_review_candidate('22222222-2222-4222-8222-222222222222',s,r,'public.v2_food_log_entries',null,2);
 if pg_catalog.jsonb_array_length(p->'rows')<>0 then raise exception 'Other owner read A food: %',p; end if;
end $test$;
reset role;
select 'PASS canonical page function Fuel projections, redaction, tombstones and tenant isolation (mock inventory only)' as acceptance;
