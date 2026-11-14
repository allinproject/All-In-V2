// ALL-246 real JWT / Auth session / PostgREST acceptance against ONLY
// disposable local Supabase CLI. Never hosted or shared staging.
// No exported keys or plaintext credentials; users are synthetic and deleted.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';

assert.equal(process.env.CI,'1','Refuse non-CI execution');
assert.equal(process.env.ALL246_LOCAL_REAL_AUTH,'1','Explicit local-only gate required');
const env=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{encoding:'utf8'})
 .split(/\r?\n/).map(line=>line.match(/^(?:export )?([A-Z_]+)=(.*)$/))
 .filter(Boolean).map(match=>[match[1],match[2].replace(/^[\"']|[\"']$/g,'')]));
const url=new URL(env.API_URL);
assert.equal(url.protocol,'http:');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Hosted Supabase is forbidden');
assert.equal(url.port,'54321','Unexpected local Supabase API port');
const anon=env.ANON_KEY,admin=env.SERVICE_ROLE_KEY;
assert.ok(anon&&admin,'Missing ephemeral local keys');
const containers=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length,1,'Only one local Supabase database permitted');
const db=containers[0];
const runSql=sql=>execFileSync('docker',['exec','-i',db,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:20000});
const applyFile=file=>execFileSync('docker',['exec','-i',db,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-f','/tmp/all246/'+file],{encoding:'utf8',timeout:20000});
const upload=file=>execFileSync('docker',['cp',file,db+':/tmp/all246/'+file.split('/').at(-1)],{encoding:'utf8',timeout:15000});
const files=[
 'V2-TRAINING-SAVED-ROUTINES-OWNER-CANDIDATE.sql',
 'V2-TRAINING-SAVED-ROUTINES-READ-CANDIDATE.sql',
 'V2-TRAINING-SAVED-ROUTINES-ARCHIVE-CANDIDATE.sql',
 'V2-TRAINING-SAVED-ROUTINES-AUTH-GATEWAY-CANDIDATE.sql',
];
execFileSync('docker',['exec',db,'mkdir','-p','/tmp/all246']);
for(const file of files){
 upload('docs/architecture/sql/'+file);
 applyFile(file);
}
runSql("NOTIFY pgrst, 'reload schema'");
const nonce=randomBytes(8).toString('hex'),users=[];
async function request(method,path,auth,body){
 const headers={apikey:anon,Authorization:'Bearer '+(auth??anon)};
 if(body!==undefined)headers['Content-Type']='application/json';
 return fetch(url.origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
}
async function adminReq(method,path,body){
 const headers={apikey:admin,Authorization:'Bearer '+admin};
 if(body!==undefined)headers['Content-Type']='application/json';
 return fetch(url.origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
}
async function rpc(name,token,args){
 const response=await request('POST','/rest/v1/rpc/'+name,token,args);
 const json=await response.json().catch(()=>null);
 return{status:response.status,json};
}
const names={
 list:'v2_training_routine_list_owner_candidate',
 read:'v2_training_routine_read_owner_candidate',
 save:'v2_training_routine_save_owner_candidate',
 archive:'v2_training_routine_archive_owner_candidate',
};
const blocks=[{kind:'strength',id:'draft-1',exercise:'Squat',equipment:null,notes:'',
 sets:3,reps:'5',weight:null,restSeconds:90,setType:'working',groupId:null}];
const list=(who,target=who.id)=>rpc(names.list,who.token,{
 p_expected_user_id:target,p_session_generation:1,p_cursor:null,p_limit:100,
});
const detail=(who,id,version=1)=>rpc(names.read,who.token,{
 p_expected_user_id:who.id,p_session_generation:1,p_routine_id:id,p_version:version,
});
const save=(who,id,version,actionId,name='Real Auth Routine')=>rpc(names.save,who.token,{
 p_expected_user_id:who.id,p_routine_id:id,p_expected_version:version,
 p_action_id:actionId,p_name:name,p_sport:'strength',p_notes:'',p_blocks:blocks,
});
const denied=status=>assert.ok([401,403].includes(status),'Expected server auth refusal, got '+status);
try{
 for(const who of ['a','b']){
  const email='all246-'+who+'-'+nonce+'@invalid.example';
  const password='C!'+randomBytes(22).toString('hex');
  const created=await adminReq('POST','/auth/v1/admin/users',{email,password,email_confirm:true});
  assert.ok([200,201].includes(created.status),'Create ephemeral user via local GoTrue');
  const {id}=await created.json();
  users.push({id,email,password});
  const signed=await request('POST','/auth/v1/token?grant_type=password',anon,{email,password});
  assert.equal(signed.status,200,'Real password sign-in '+who);
  const session=await signed.json();
  users.at(-1).token=session.access_token;
  assert.ok(session.access_token,'Missing JWT');
  const verified=await request('GET','/auth/v1/user',session.access_token);
  assert.equal(verified.status,200,'GoTrue access-token proof');
  assert.equal((await verified.json()).id,id);
 }
 const [a,b]=users;
 for(let attempt=0;attempt<12;attempt++){
  const ready=await list(a);
  if(ready.status===200)break;
  if(attempt===11)throw Error('Owner RPC never became available: '+ready.status);
  await new Promise(resolve=>setTimeout(resolve,750));
 }
 assert.equal((await list(a)).status,200,'Authenticated empty list');
 denied((await rpc(names.list,null,{p_expected_user_id:a.id,p_session_generation:1,p_cursor:null,p_limit:100})).status);
 const created=await save(a,null,0,randomUUID());
 assert.equal(created.status,200,'User A authenticated create');
 assert.equal(created.json.version,1);
 const routineId=created.json.routineId;
 assert.ok(routineId,'Missing server Routine identity');
 const aList=await list(a);
 assert.equal(aList.status,200);
 assert.equal(aList.json.records.length,1);
 assert.equal(aList.json.records[0].routineId,routineId);
 assert.equal((await detail(a,routineId)).json.name,'Real Auth Routine');
 assert.equal((await detail(b,routineId)).json,null,'B cannot guess/read A version');
 assert.equal((await list(b)).json.records.length,0,'B cannot list A');
 denied((await list(a,b.id)).status);
 denied((await save(b,routineId,1,randomUUID(),'Cross-account hijack')).status);
 const edit=await save(a,routineId,1,randomUUID(),'Revised Real Auth Routine');
 assert.equal(edit.status,200);
 assert.equal(edit.json.version,2);
 const stale=await save(a,routineId,1,randomUUID(),'Stale edit');
 assert.notEqual(stale.status,200,'Lost CAS update was accepted');
 const old=await detail(a,routineId,1);
 assert.equal(old.status,200);
 assert.equal(old.json.name,'Real Auth Routine','Immutable old version must survive');
 const archived=await rpc(names.archive,a.token,{
  p_expected_user_id:a.id,p_routine_id:routineId,p_expected_version:2,p_action_id:randomUUID(),
 });
 assert.equal(archived.status,200,'Authenticated archive');
 assert.equal(archived.json.archived,true);
 assert.equal((await list(a)).json.records.length,0,'Archive no longer in active library');
 assert.equal((await detail(a,routineId,1)).json,null,'Archived routine inaccessible for active read');
 // Actually revoke GoTrue session at the database, not merely signOut/refresh;
 // old JWT remains cryptographically valid, but our owner gate must deny it.
 const tokenClaims=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url').toString());
 assert.match(tokenClaims.session_id,/^[a-f0-9-]{36}$/i);
 runSql("DELETE FROM auth.sessions WHERE id='"+tokenClaims.session_id+"'");
 denied((await list(a)).status);
 denied((await save(a,null,0,randomUUID(),'Revoked user')).status);
 // B still has a valid authenticated session.
 assert.equal((await list(b)).status,200,'B unaffected by A revocation');
 console.log('PASS ALL-246 LOCAL REAL JWT / two GoTrue sessions / owner-only list-read-CAS-archive / session revoke');
}finally{
 for(const user of users){
  try{await adminReq('DELETE','/auth/v1/admin/users/'+user.id);}catch{}
 }
 // CI process exits and the local Supabase Docker environment is destroyed.
}
