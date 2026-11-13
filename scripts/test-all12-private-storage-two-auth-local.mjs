// ALL-12: local-only private Storage ownership with two REAL Auth sessions.
// Synthetic accounts, ephemeral bucket, no hosted access or live secrets.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
assert.equal(process.env.CI,'1');
const env=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{encoding:'utf8'})
 .split(/\r?\n/).map(s=>s.match(/^(?:export )?([A-Z_]+)=(.*)$/))
 .filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const base=new URL(env.API_URL);
assert.equal(base.protocol,'http:');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname)&&base.port==='54321');
const admin=env.SERVICE_ROLE_KEY,anon=env.ANON_KEY;
assert.ok(admin&&anon);
const nonce=randomBytes(8).toString('hex'),bucket='all12-private-restore-'+nonce;
const users=[],paths=[];
const dbCandidates=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
assert.equal(dbCandidates.length,1,'Refusing ambiguous local Supabase database selection');
const [db]=dbCandidates;
const sql=s=>execFileSync('docker',['exec','-i',db,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'});
async function req(method,path,key,token,body,contentType){
 const headers={apikey:key,Authorization:'Bearer '+(token??key)};
 if(body!==undefined)headers['Content-Type']=contentType??'application/json';
 return fetch(base.origin+path,{method,headers,body:body===undefined?undefined:contentType?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
}
const hash=b=>createHash('sha256').update(b).digest('hex');
let policy=false,createdBucket=false,backupDir=null;
try{
 for(const who of ['a','b']){
  const email='all12-'+who+'-'+nonce+'@invalid.example',password='A!'+randomBytes(24).toString('hex');
  const created=await req('POST','/auth/v1/admin/users',admin,null,{email,password,email_confirm:true});
  assert.ok([200,201].includes(created.status),'create synthetic Auth account');
  const {id}=await created.json();users.push({id,email,password});
  const login=await req('POST','/auth/v1/token?grant_type=password',anon,null,{email,password});
  assert.equal(login.status,200,'real local password sign-in');
  const signedIn=await login.json();
  users.at(-1).token=signedIn.access_token;
  users.at(-1).refresh=signedIn.refresh_token;
  assert.ok(users.at(-1).token && users.at(-1).refresh);
 }
 // Exercise a real Auth password login AFTER a synthetic identity-row
 // deletion/restoration, without copying any live password or JWT secret.
 // Keep this local-only and retain the original Auth user/password hash.
 const ownerForIdentity=users[0];
 const identityRoundtrip=`DO $all12$
 DECLARE saved auth.identities%ROWTYPE; n integer;
 BEGIN
  SELECT count(*) INTO n FROM auth.identities WHERE user_id='${ownerForIdentity.id}'::uuid;
  IF n<>1 THEN RAISE EXCEPTION 'Expected exactly one synthetic email identity'; END IF;
  SELECT * INTO saved FROM auth.identities WHERE user_id='${ownerForIdentity.id}'::uuid;
  DELETE FROM auth.identities WHERE id=saved.id;
  IF EXISTS(SELECT 1 FROM auth.identities WHERE id=saved.id)
  THEN RAISE EXCEPTION 'Identity deletion failed'; END IF;
  INSERT INTO auth.identities(id,provider_id,user_id,provider,identity_data,created_at,updated_at,last_sign_in_at)
  VALUES(saved.id,saved.provider_id,saved.user_id,saved.provider,saved.identity_data,
         saved.created_at,saved.updated_at,saved.last_sign_in_at);
  IF (SELECT count(*) FROM auth.identities WHERE id=saved.id AND user_id=saved.user_id AND
     provider_id=saved.provider_id AND identity_data=saved.identity_data)<>1
  THEN RAISE EXCEPTION 'Identity recovery mismatch'; END IF;
 END $all12$`;
 sql(identityRoundtrip);
 const relogin=await req('POST','/auth/v1/token?grant_type=password',anon,null,{
  email:ownerForIdentity.email,password:ownerForIdentity.password,
 });
 assert.equal(relogin.status,200,'password sign-in after synthetic identity restoration');
 const reloginToken=(await relogin.json()).access_token;
 const recoveredUser=await req('GET','/auth/v1/user',anon,reloginToken);
 assert.equal(recoveredUser.status,200,'restored identity session must resolve');
 assert.equal((await recoveredUser.json()).id,ownerForIdentity.id,
  'restored identity login must retain original owner');
 // ALL-12: exercise synthetic Auth password verifier backup/erase/restore
 // and verify the real GoTrue sign-in rejects the erased verifier.
 // No production passwords, hashes, signing keys or external providers.
 const verifierOwner=users[1];
 const verifierBefore=sql(`SELECT md5(encrypted_password) FROM auth.users
   WHERE id='${verifierOwner.id}'::uuid`).trim();
 assert.match(verifierBefore,/[a-f0-9]{32}/);
 // Preserve the exact synthetic verifier in the disposable database only.
 sql(`CREATE TABLE IF NOT EXISTS public.all12_ephemeral_auth_verifier_restore
   (user_id uuid primary key, encrypted_password text not null);
   INSERT INTO public.all12_ephemeral_auth_verifier_restore(user_id,encrypted_password)
   SELECT id,encrypted_password FROM auth.users WHERE id='${verifierOwner.id}'::uuid;
   UPDATE auth.users SET encrypted_password=NULL WHERE id='${verifierOwner.id}'::uuid;`);
 try {
  const denied=await req('POST','/auth/v1/token?grant_type=password',anon,null,{
   email:verifierOwner.email,password:verifierOwner.password,
  });
  assert.notEqual(denied.status,200,'erased synthetic verifier must deny password sign-in');
 } finally {
  sql(`UPDATE auth.users u SET encrypted_password=v.encrypted_password
    FROM public.all12_ephemeral_auth_verifier_restore v
    WHERE u.id=v.user_id AND u.id='${verifierOwner.id}'::uuid;
    DROP TABLE public.all12_ephemeral_auth_verifier_restore;`);
 }
 const verifierAfter=sql(`SELECT md5(encrypted_password) FROM auth.users
   WHERE id='${verifierOwner.id}'::uuid`).trim();
 assert.equal(verifierAfter,verifierBefore,'synthetic password verifier fingerprint');
 const verifierLogin=await req('POST','/auth/v1/token?grant_type=password',anon,null,{
  email:verifierOwner.email,password:verifierOwner.password,
 });
 assert.equal(verifierLogin.status,200,'real password sign-in after verifier restore');
 const verifierSession=(await verifierLogin.json()).access_token;
 const verifierIdentity=await req('GET','/auth/v1/user',anon,verifierSession);
 assert.equal(verifierIdentity.status,200);
 assert.equal((await verifierIdentity.json()).id,verifierOwner.id,
  'restored verifier must authenticate only its original owner');
 const [a,b]=users;
 const created=await req('POST','/storage/v1/bucket',admin,null,{id:bucket,name:bucket,public:false});
 assert.ok(created.ok,'create private test bucket');createdBucket=true;
 // A single owner-prefix read policy scoped to this disposable bucket.
 // This fixture does not modify the canonical production Storage policies.
 sql(`CREATE POLICY "all12_${nonce}" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='${bucket}' AND split_part(name,'/',1)=(SELECT auth.uid()::text))`);
 policy=true;
 // Save a separate local artifact before deleting Storage's source bytes.
 backupDir=mkdtempSync(join(tmpdir(),'all12-private-'));
 const backupPath=join(backupDir,'restore.bin');
 let bytes=randomBytes(131072);
 const originalSha256=hash(bytes);
 writeFileSync(backupPath,bytes,{flag:'wx',mode:0o600});
 assert.equal(hash(readFileSync(backupPath)),originalSha256,'backup artifact digest mismatch');
 const path=a.id+'/recovered.bin';paths.push(path);
 const upload=await req('POST','/storage/v1/object/'+bucket+'/'+path,admin,null,bytes,'application/octet-stream');
 assert.ok(upload.ok,'upload synthetic owner media');
 const own=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,a.token);
 assert.equal(own.status,200,'owner can read private file');
 assert.equal(hash(Buffer.from(await own.arrayBuffer())),originalSha256,'owner bytes match');
 const foreign=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,b.token);
 assert.ok([400,401,403,404].includes(foreign.status),'valid foreign session downloaded owner file');
 const anonymous=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,anon);
 assert.ok([400,401,403,404].includes(anonymous.status),'anonymous downloaded owner file');
 const removed=await req('DELETE','/storage/v1/object/'+bucket+'/'+path,admin,null);
 assert.ok(removed.ok,'delete owner source before recovery');
 const absent=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,a.token);
 assert.ok([400,404].includes(absent.status),'source object must be unavailable before restoration');
 bytes=null; // Restore from the independently persisted artifact, not the original buffer.
 const recoveryBytes=readFileSync(backupPath);
 assert.equal(hash(recoveryBytes),originalSha256,'backup artifact changed');
 const restore=await req('POST','/storage/v1/object/'+bucket+'/'+path,admin,null,recoveryBytes,'application/octet-stream');
 assert.ok(restore.ok,'restore private source file');
 const ownRestored=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,a.token);
 assert.equal(ownRestored.status,200,'owner restored file readable');
 assert.equal(hash(Buffer.from(await ownRestored.arrayBuffer())),originalSha256,'restored SHA-256 mismatch');
 const foreignRestored=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,b.token);
 assert.ok([400,401,403,404].includes(foreignRestored.status),'foreign session downloaded RESTORED file');
 // Refresh the independent foreign session, then repeat the denial with
 // its newly issued access token (not merely the original login token).
 const refresh=await req('POST','/auth/v1/token?grant_type=refresh_token',anon,null,{refresh_token:b.refresh});
 assert.equal(refresh.status,200,'valid User B refresh token must work');
 const refreshed=await refresh.json();
 assert.ok(refreshed.access_token && refreshed.refresh_token,'rotated session tokens required');
 b.token=refreshed.access_token;b.refresh=refreshed.refresh_token;
 const bIdentity=await req('GET','/auth/v1/user',anon,b.token);
 assert.equal(bIdentity.status,200,'refreshed User B session must be authenticated');
 assert.equal((await bIdentity.json()).id,b.id,'refreshed token must remain bound to B');
 const foreignRotated=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,b.token);
 assert.ok([400,401,403,404].includes(foreignRotated.status),
  'refreshed User B token downloaded restored User A file');
 const logout=await req('POST','/auth/v1/logout',anon,b.token);
 assert.ok([200,204].includes(logout.status),'User B logout must succeed');
 const replay=await req('POST','/auth/v1/token?grant_type=refresh_token',anon,null,{refresh_token:b.refresh});
 assert.ok([400,401,403].includes(replay.status),'logged-out refresh token remained reusable');
 // Access JWTs may remain valid until expiration: logout revokes refresh
 // credentials, not necessarily already-issued bearer JWTs.
 console.log('PASS ALL-12: persisted fixture bytes restored; valid second Auth session denied private bytes; owner SHA-256 verified');
}finally{
 const cleanupErrors=[];
 if(policy){
  try{sql(`DROP POLICY IF EXISTS "all12_${nonce}" ON storage.objects`);}
  catch(e){cleanupErrors.push('policy: '+e.message);}
 }
 for(const path of paths.reverse()){
  try{const r=await req('DELETE','/storage/v1/object/'+bucket+'/'+path,admin,null);if(!r.ok)cleanupErrors.push('file HTTP '+r.status);}
  catch(e){cleanupErrors.push('file: '+e.message);}
 }
 if(createdBucket){
  try{const r=await req('DELETE','/storage/v1/bucket/'+bucket,admin,null);if(!r.ok)cleanupErrors.push('bucket HTTP '+r.status);}
  catch(e){cleanupErrors.push('bucket: '+e.message);}
 }
 for(const {id} of users.reverse()){
  try{const r=await req('DELETE','/auth/v1/admin/users/'+id,admin,null);if(!r.ok)cleanupErrors.push('user HTTP '+r.status);}
  catch(e){cleanupErrors.push('user: '+e.message);}
 }
 if(backupDir){
  try{rmSync(backupDir,{recursive:true,force:true});}
  catch(e){cleanupErrors.push('backup artifact: '+e.message);}
 }
 assert.deepEqual(cleanupErrors,[],'ALL-12 fixture cleanup must complete');
}
