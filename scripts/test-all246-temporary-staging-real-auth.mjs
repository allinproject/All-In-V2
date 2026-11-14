// ALL-246 hosted temporary-staging, real GoTrue JWT / PostgREST acceptance.
// NEVER target canonical V2, never log API keys, JWTs, passwords or synthetic IDs.
// A protected staging secret is used ONLY for synthetic user provisioning/cleanup.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const ref='fbtgknlxjyeqrxemskbl';
const base='https://'+ref+'.supabase.co';
const e=process.env;
assert.equal(e.CI,'true');
assert.equal(e.ALL246_TEMP_STAGING_ALLOW,'true');
assert.equal(e.ALL246_TEMP_STAGING_REF,ref);
assert.equal(e.ALL246_TEMP_STAGING_URL,base);
const key=e.ALL251_TEMP_STAGING_SECRET_KEY,anon=e.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(key??''),'Protected staging secret key required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(anon??''),'Staging publishable key required');
assert.notEqual(key,anon);
const created=[],password=randomUUID()+'aA!9';
const call=async(path,{method='GET',body,token=null,apiKey=anon}={})=>{
 assert(apiKey===key||apiKey===anon);
 assert(token===null||(typeof token==='string'&&token.split('.').length===3));
 const res=await fetch(base+path,{
  method,redirect:'manual',signal:AbortSignal.timeout(30000),
  headers:{apikey:apiKey,...(token?{authorization:'Bearer '+token}:{}),
   ...(body===undefined?{}:{'content-type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 });
 assert.equal(res.redirected,false);
 return {status:res.status,body:await res.json().catch(()=>null)};
};
const rpc=(name,args,token)=>call('/rest/v1/rpc/'+name,{method:'POST',body:args,token});
const denied=({status},label)=>assert([400,401,403,404].includes(status),label+' unexpectedly allowed');
const expectedSqlRejection=({status,body},sqlstate,label)=>{
 assert(status>=400&&status<600,label+' unexpectedly succeeded');
 assert.equal(body?.code,sqlstate,label+' returned the wrong rejection type');
};
const list=(u,owner=u.id)=>rpc('v2_training_routine_list_owner_candidate',
 {p_expected_user_id:owner,p_session_generation:1,p_cursor:null,p_limit:100},u.token);
const read=(u,routine,version)=>rpc('v2_training_routine_read_owner_candidate',
 {p_expected_user_id:u.id,p_session_generation:1,p_routine_id:routine,p_version:version},u.token);
const blocks=[{kind:'strength',id:'draft-1',exercise:'Squat',equipment:null,notes:'',
 sets:3,reps:'5',weight:null,restSeconds:90,setType:'working',groupId:null}];
const save=(u,routine,version,action,name='Staged Auth Routine')=>rpc('v2_training_routine_save_owner_candidate',
 {p_expected_user_id:u.id,p_routine_id:routine,p_expected_version:version,
  p_action_id:action,p_name:name,p_sport:'strength',p_notes:'',p_blocks:blocks},u.token);
let failed=false,step='startup',a=null,b=null;
try{
 step='hosted synthetic Auth provisioning';
 for(const label of ['a','b']){
  const email='all246-'+label+'-'+randomUUID()+'@example.invalid';
  const c=await call('/auth/v1/admin/users',{method:'POST',apiKey:key,
   body:{email,password,email_confirm:true,user_metadata:{all246_staging_only:true}}});
  assert([200,201].includes(c.status),'Synthetic Auth creation denied');
  assert(typeof c.body?.id==='string');
  created.push(c.body.id);
  const signed=await call('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  assert.equal(signed.status,200,'Real hosted password sign-in rejected');
  assert.equal(signed.body?.user?.id,c.body.id);
  assert(typeof signed.body?.access_token==='string'&&signed.body.access_token.split('.').length===3);
  const verify=await call('/auth/v1/user',{token:signed.body.access_token});
  assert.equal(verify.status,200,'Host Auth getUser rejected token');
  assert.equal(verify.body?.id,c.body.id);
  if(label==='a')a={id:c.body.id,token:signed.body.access_token};
  else b={id:c.body.id,token:signed.body.access_token};
 }
 assert.notEqual(a.token,b.token);
 step='empty owner list and anonymous/direct table denial';
 const al=await list(a);assert.equal(al.status,200,'Owner A list rejected');
 assert.deepEqual(al.body?.records,[],'A must start empty');
 const noToken=await call('/rest/v1/rpc/v2_training_routine_list_owner_candidate',{
  method:'POST',body:{p_expected_user_id:a.id,p_session_generation:1,p_cursor:null,p_limit:100}});
 denied(noToken,'Anonymous owner RPC');
 denied(await call('/rest/v1/v2_training_routines?select=id',{token:a.token}),'Direct owner table read');
 denied(await call('/rest/v1/v2_training_routine_versions?select=version',{token:b.token}),'Direct version table read');
 step='authenticated create';
 const action=randomUUID();
 const one=await save(a,null,0,action);
 assert.equal(one.status,200,'A create refused');
 assert.equal(one.body?.version,1);
 const routine=one.body?.routineId;assert(typeof routine==='string');
 step='idempotent same-action replay';
 const replay=await save(a,null,0,action);
 assert.equal(replay.status,200,'Identical action replay refused');
 assert.equal(replay.body?.routineId,routine);
 assert.equal(replay.body?.replayed,true);
 step='changed-payload action conflict';
 expectedSqlRejection(
  await save(a,null,0,action,'Conflicting replay'),
  '23505','Conflicting action replay');
 step='authenticated owner read';
 const own=await list(a);
 assert.equal(own.status,200);assert.equal(own.body?.records?.length,1);
 assert.equal(own.body.records[0].routineId,routine);
 assert.equal((await read(a,routine,1)).body?.name,'Staged Auth Routine');
 step='other user isolation';
 assert.equal((await list(b)).body?.records?.length,0);
 assert.equal((await read(b,routine,1)).body,null,'User B guessed exact Routine');
 denied(await list(a,b.id),'Cross-owner identity');
 denied(await save(b,routine,1,randomUUID(),'Hijack'),'Cross-owner version modification');
 step='version CAS update';
 const updated=await save(a,routine,1,randomUUID(),'Updated Staged Routine');
 assert.equal(updated.status,200);
 assert.equal(updated.body?.version,2);
 step='stale-version CAS rejection';
 expectedSqlRejection(
  await save(a,routine,1,randomUUID(),'Stale change'),
  'PT409','Stale CAS');
 step='immutable version and archive';
 assert.equal((await read(a,routine,1)).body?.name,'Staged Auth Routine');
 const archived=await rpc('v2_training_routine_archive_owner_candidate',
  {p_expected_user_id:a.id,p_routine_id:routine,p_expected_version:2,p_action_id:randomUUID()},a.token);
 assert.equal(archived.status,200);assert.equal(archived.body?.archived,true);
 assert.equal((await list(a)).body?.records?.length,0);
 assert.equal((await read(a,routine,1)).body,null);
 step='revoked real session denial';
 const logout=await call('/auth/v1/logout?scope=local',{method:'POST',token:a.token});
 assert([200,204].includes(logout.status),'Logout failed');
 // The JWT itself remains cryptographically valid, but Routine owner checks
 // require its session_id to remain present in auth.sessions.
 denied(await list(a),'Revoked token list');
 denied(await save(a,null,0,randomUUID(),'Revoked token write'),'Revoked token write');
 assert.equal((await list(b)).status,200,'User B affected by A logout');
 console.log('PASS ALL-246 HOSTED temporary staging: two real Auth JWTs, ACL, owner CRUD, CAS, replay, archive, session revocation');
}catch(err){
 failed=true;
 console.error('FAIL ALL-246 hosted staging checkpoint: '+step+' ('+
  (err instanceof Error?err.name:'error')+'; no credentials, user IDs or response bodies disclosed)');
}finally{
 for(const id of created.reverse()){
  try{
   // Do NOT call ALL-251's synthetic cleanup RPC: its all251-only identity
   // prefix and metadata checks correctly reject these unrelated ALL-246 users.
   // Exact Auth identity and synthetic marker must match what THIS run created.
   const checked=await call('/auth/v1/admin/users/'+encodeURIComponent(id),{apiKey:key});
   assert.equal(checked.status,200,'Synthetic Auth user lookup refused');
   const person=checked.body?.user??checked.body;
   assert.equal(person?.id,id,'Synthetic Auth identity mismatch');
   assert.match(person?.email??'',/^all246-[ab]-[a-f0-9-]+@example\.invalid$/);
   assert.equal(person?.user_metadata?.all246_staging_only,true,
    'Refusing delete of unmarked synthetic user');
   const del=await call('/auth/v1/admin/users/'+encodeURIComponent(id),{method:'DELETE',apiKey:key});
   assert([200,204].includes(del.status),'Synthetic user deletion refused');
   const gone=await call('/auth/v1/admin/users/'+encodeURIComponent(id),{apiKey:key});
   assert.equal(gone.status,404,'Synthetic user remains after delete ACK');
  }catch{
   failed=true;console.error('CLEANUP FAILED: synthetic ALL-246 Auth identity requires staging inspection');
  }
 }
 if(created.length!==2){failed=true;console.error('Incomplete two-owner fixture');}
}
if(failed)process.exitCode=1;
