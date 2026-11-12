'use strict';
// ALL-222 read-only hosted reviewer connection acceptance. Never print or pass
// vault passwords via CLI arguments, Git, or mobile client.
const {spawnSync}=require('node:child_process');
const {existsSync}=require('node:fs');
const PROJECT='fbtgknlxjyeqrxemskbl',ROLE='allin_v2_ingredient_reviewer';
const SIGNATURE='allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)';
function assertConfig(env){
 const deny=(message)=>{throw new Error(message)};
 if(env.ALLIN_ALLOW_HOSTED_REVIEWER_SMOKE!=='1')deny('Explicit staging test opt-in required');
 if(env.ALLIN_SUPABASE_PROJECT_REF!==PROJECT)deny('Refusing a non-approved staging project');
 if(!/^(?:db\.[a-z0-9]+\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com)$/.test(env.PGHOST||''))deny('Supabase database host required');
 if(env.PGPORT!=='5432'||env.PGDATABASE!=='postgres')deny('Direct/session mode on port 5432 required; transaction pooling prohibited');
 if(env.PGSSLMODE!=='verify-full'||!env.PGSSLROOTCERT||!existsSync(env.PGSSLROOTCERT))deny('Verified server TLS and a trusted CA file required');
 if(!env.PGPASSFILE||!existsSync(env.PGPASSFILE))deny('Vault-managed PGPASSFILE required');
 if(env.PGPASSWORD||env.DATABASE_URL||env.PGURI)deny('Inline password/URI not accepted');
 if(['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGCONNECT_TIMEOUT','PGTARGETSESSIONATTRS'].some(key=>env[key]))deny('Connection override is prohibited for reviewer acceptance');
 const login=env.ALLIN_REVIEWER_EXPECTED_DB_LOGIN||'';
 if(!/^allin_ing_reviewer_[a-z0-9_]{6,35}$/.test(login))deny('Approved unique reviewer login required');
 const direct=env.PGHOST==='db.'+PROJECT+'.supabase.co';
 const pooled=/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(env.PGHOST||'');
 if(!direct&&!pooled)deny('Refusing a database host outside approved staging');
 if((direct&&env.PGUSER!==login)||(pooled&&env.PGUSER!==login+'.'+PROJECT))deny('PGUSER does not match approved project-specific reviewer login');
 return {login};
}
function acceptanceQuery(login){
 return `BEGIN READ ONLY;
SET LOCAL ROLE ${ROLE};
SELECT json_build_object(
 'session_matches_expected',session_user::text='${login}',
 'role_matches_reviewer',current_user::text='${ROLE}',
 'reviewer_membership',pg_has_role(session_user,'${ROLE}','member'),
 'review_function_execute',has_function_privilege(current_user,'${SIGNATURE}','EXECUTE'),
 'athlete_profile_write',has_table_privilege(current_user,'public.v2_ingredient_nutrition_profiles','UPDATE'),
 'private_audit_read',has_table_privilege(current_user,'allin_private.v2_ingredient_review_events','SELECT'),
 'login_direct_profile_write',has_table_privilege(session_user,'public.v2_ingredient_nutrition_profiles','UPDATE'),
 'login_private_audit_read',has_table_privilege(session_user,'allin_private.v2_ingredient_review_events','SELECT'),
 'login_schema_create',has_schema_privilege(session_user,'public','CREATE') OR has_schema_privilege(session_user,'allin_private','CREATE'),
 'reviewer_schema_create',has_schema_privilege(current_user,'public','CREATE') OR has_schema_privilege(current_user,'allin_private','CREATE'),
 'login_privileged',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)),
 'reviewer_privileged',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)),
 'login_admin_role_member',EXISTS (
   SELECT 1 FROM pg_roles r
   WHERE (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
     OR r.rolname IN ('postgres','service_role','pg_read_all_data','pg_write_all_data','pg_execute_server_program','pg_read_server_files','pg_write_server_files'))
     AND pg_has_role(session_user,r.oid,'member')
 )
)::text;
ROLLBACK;`;
}
function checkProof(proof){
 for(const field of ['session_matches_expected','role_matches_reviewer','reviewer_membership','review_function_execute'])
   if(proof?.[field]!==true)throw new Error('Reviewer acceptance failed: '+field);
 for(const field of ['athlete_profile_write','private_audit_read','login_direct_profile_write','login_private_audit_read','login_schema_create','reviewer_schema_create','login_privileged','reviewer_privileged','login_admin_role_member'])
   if(proof?.[field]!==false)throw new Error('Excessive reviewer privilege: '+field);
 return {ok:true,connection:'verified-dedicated-session',reviewerFunction:'execute-only',directWrites:false,auditReads:false};
}
function main(env=process.env){
 const {login}=assertConfig(env);
 const clean={...env};delete clean.DATABASE_URL;delete clean.PGURI;
 const r=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',acceptanceQuery(login)],
   {env:clean,encoding:'utf8',timeout:20000,maxBuffer:8192});
 if(r.error||r.status!==0)throw new Error('Hosted connection/permissions rejected; inspect only trusted operator logs');
 const line=(r.stdout||'').split('\n').map(s=>s.trim()).find(s=>s.startsWith('{'));
 if(!line)throw new Error('No safe security proof received');
 process.stdout.write(JSON.stringify(checkProof(JSON.parse(line)))+'\n');
}
if(require.main===module){try{main()}catch(e){process.stderr.write('ALL-222 acceptance blocked: '+e.message+'\n');process.exitCode=1}}
module.exports={assertConfig,acceptanceQuery,checkProof,main};
