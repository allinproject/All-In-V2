'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {checkProof,acceptanceQuery,assertConfig}=require('./check-v2-ingredient-hosted-reviewer-connection.cjs');
const valid={session_matches_expected:true,role_matches_reviewer:true,reviewer_membership:true,review_function_execute:true,athlete_profile_write:false,private_audit_read:false,login_direct_profile_write:false,login_private_audit_read:false,login_schema_create:false,reviewer_schema_create:false,login_privileged:false,reviewer_privileged:false,login_admin_role_member:false};
test('valid reviewer session is narrow and read-only',()=>assert.equal(checkProof(valid).ok,true));
test('rejects mismatched identity or excessive privileges',()=>{for(const key of Object.keys(valid))assert.throws(()=>checkProof({...valid,[key]:!valid[key]}))});
test('rejects unapproved staging and missing operator before connection',()=>{assert.throws(()=>assertConfig({}),/opt-in/);assert.throws(()=>assertConfig({ALLIN_ALLOW_HOSTED_REVIEWER_SMOKE:'1',ALLIN_SUPABASE_PROJECT_REF:'xarhuczrtzuiljmtdaeu'}),/staging/)});
test('acceptance SQL is read-only and has scoped role activation',()=>{const sql=acceptanceQuery('allin_ing_reviewer_test_operator');assert.match(sql,/BEGIN READ ONLY/);assert.match(sql,/SET LOCAL ROLE/);assert.match(sql,/ROLLBACK/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE\s+public|DELETE\s+FROM|CREATE\s+ROLE|ALTER\s+ROLE)\b/i)});

test('staging cannot be redirected to a different direct Supabase project',()=>{
 const fake={ALLIN_ALLOW_HOSTED_REVIEWER_SMOKE:'1',ALLIN_SUPABASE_PROJECT_REF:'fbtgknlxjyeqrxemskbl',PGHOST:'db.xarhuczrtzuiljmtdaeu.supabase.co',PGPORT:'5432',PGDATABASE:'postgres',PGSSLMODE:'verify-full',PGSSLROOTCERT:process.execPath,PGPASSFILE:process.execPath,ALLIN_REVIEWER_EXPECTED_DB_LOGIN:'allin_ing_reviewer_testoperator',PGUSER:'allin_ing_reviewer_testoperator'};
 assert.throws(()=>assertConfig(fake),/outside approved staging/);
});

test('sole-founder reviewer must not inherit admin, schema DDL or direct profile rights',()=>{
 const q=acceptanceQuery('allin_ing_reviewer_founder_test');
 assert.match(q,/has_table_privilege\(session_user,'public\.v2_ingredient_nutrition_profiles','UPDATE'\)/);
 assert.match(q,/has_schema_privilege\(session_user,'public','CREATE'\)/);
 assert.match(q,/has_schema_privilege\(current_user,'allin_private','CREATE'\)/);
 assert.match(q,/rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls/);
 for (const field of ['login_direct_profile_write','login_private_audit_read','login_schema_create','reviewer_schema_create','login_privileged','reviewer_privileged','login_admin_role_member'])
  assert.throws(()=>checkProof({...valid,[field]:true}),/Excessive reviewer privilege/);
});

test('reviewer login cannot assume privileged Postgres group roles',()=>{
 const q=acceptanceQuery('allin_ing_reviewer_solo_founder');
 for (const forbidden of ['postgres','service_role','pg_read_all_data','pg_write_all_data','pg_execute_server_program','pg_read_server_files','pg_write_server_files'])
  assert.ok(q.includes(forbidden),'missing privilege restriction: '+forbidden);
 assert.match(q,/pg_has_role\(session_user,r\.oid,'member'\)/);
 assert.throws(()=>checkProof({...valid,login_admin_role_member:true}),/Excessive reviewer privilege/);
});

test('prohibit libpq environment redirection before connecting',()=>{
 const base={ALLIN_ALLOW_HOSTED_REVIEWER_SMOKE:'1',ALLIN_SUPABASE_PROJECT_REF:'fbtgknlxjyeqrxemskbl',PGHOST:'db.fbtgknlxjyeqrxemskbl.supabase.co',PGPORT:'5432',PGDATABASE:'postgres',PGSSLMODE:'verify-full',PGSSLROOTCERT:process.execPath,PGPASSFILE:process.execPath,ALLIN_REVIEWER_EXPECTED_DB_LOGIN:'allin_ing_reviewer_testoperator',PGUSER:'allin_ing_reviewer_testoperator'};
 assert.equal(assertConfig(base).login,'allin_ing_reviewer_testoperator');
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGCONNECT_TIMEOUT','PGTARGETSESSIONATTRS'])
  assert.throws(()=>assertConfig({...base,[key]:'unexpected'}),/Connection override/);
});
