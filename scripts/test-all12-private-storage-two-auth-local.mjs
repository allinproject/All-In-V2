// ALL-12: local-only private Storage ownership with two REAL Auth sessions.
// Synthetic accounts, ephemeral bucket, no hosted access or live secrets.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
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
const db=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n')[0];
assert.ok(db);
const sql=s=>execFileSync('docker',['exec','-i',db,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'});
async function req(method,path,key,token,body,contentType){
 const headers={apikey:key,Authorization:'Bearer '+(token??key)};
 if(body!==undefined)headers['Content-Type']=contentType??'application/json';
 return fetch(base.origin+path,{method,headers,body:body===undefined?undefined:contentType?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
}
const hash=b=>createHash('sha256').update(b).digest('hex');
let policy=false,createdBucket=false;
try{
 for(const who of ['a','b']){
  const email='all12-'+who+'-'+nonce+'@invalid.example',password='A!'+randomBytes(24).toString('hex');
  const created=await req('POST','/auth/v1/admin/users',admin,null,{email,password,email_confirm:true});
  assert.ok([200,201].includes(created.status),'create synthetic Auth account');
  const {id}=await created.json();users.push({id});
  const login=await req('POST','/auth/v1/token?grant_type=password',anon,null,{email,password});
  assert.equal(login.status,200,'real local password sign-in');
  users.at(-1).token=(await login.json()).access_token;
  assert.ok(users.at(-1).token);
 }
 const [a,b]=users;
 const created=await req('POST','/storage/v1/bucket',admin,null,{id:bucket,name:bucket,public:false});
 assert.ok(created.ok,'create private test bucket');createdBucket=true;
 // A single owner-prefix read policy scoped to this disposable bucket.
 // This fixture does not modify the canonical production Storage policies.
 sql(`CREATE POLICY "all12_${nonce}" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='${bucket}' AND split_part(name,'/',1)=(SELECT auth.uid()::text))`);
 policy=true;
 const bytes=randomBytes(131072),path=a.id+'/recovered.bin';paths.push(path);
 const upload=await req('POST','/storage/v1/object/'+bucket+'/'+path,admin,null,bytes,'application/octet-stream');
 assert.ok(upload.ok,'upload synthetic owner media');
 const own=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,a.token);
 assert.equal(own.status,200,'owner can read private file');
 assert.equal(hash(Buffer.from(await own.arrayBuffer())),hash(bytes),'owner bytes match');
 const foreign=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,b.token);
 assert.ok([400,401,403,404].includes(foreign.status),'valid foreign session downloaded owner file');
 const anonymous=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,anon);
 assert.ok([400,401,403,404].includes(anonymous.status),'anonymous downloaded owner file');
 const removed=await req('DELETE','/storage/v1/object/'+bucket+'/'+path,admin,null);
 assert.ok(removed.ok,'delete owner source before recovery');
 const restore=await req('POST','/storage/v1/object/'+bucket+'/'+path,admin,null,bytes,'application/octet-stream');
 assert.ok(restore.ok,'restore private source file');
 const ownRestored=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,a.token);
 assert.equal(ownRestored.status,200,'owner restored file readable');
 assert.equal(hash(Buffer.from(await ownRestored.arrayBuffer())),hash(bytes),'restored SHA-256 mismatch');
 const foreignRestored=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+path,anon,b.token);
 assert.ok([400,401,403,404].includes(foreignRestored.status),'foreign session downloaded RESTORED file');
 console.log('PASS ALL-12: valid second Auth session denied restored private bytes; owner read and SHA-256 verified');
}finally{
 if(policy)sql(`DROP POLICY IF EXISTS "all12_${nonce}" ON storage.objects`);
 for(const path of paths.reverse())await req('DELETE','/storage/v1/object/'+bucket+'/'+path,admin,null);
 if(createdBucket)await req('DELETE','/storage/v1/bucket/'+bucket,admin,null);
 for(const {id} of users.reverse())await req('DELETE','/auth/v1/admin/users/'+id,admin,null);
}
