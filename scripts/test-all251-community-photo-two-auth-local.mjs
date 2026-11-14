/**
 * ALL-251 LOCAL-ONLY Community photo bytes acceptance.
 * Run in a disposable local Supabase stack with CI=1. No hosted URL,
 * no production bucket, no new upload endpoint, no release authorization.
 *
 * Real GoTrue A/B sessions + real private Storage REST bytes; server-role
 * fixture uploads simulate a FUTURE approved writer and do not prove an
 * attested upload lease, Community ledger transaction, or deletion freeze.
 * The canonical SQL ledger is replayed separately in PostgreSQL CI.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {createLocalDeletionStorageTransport} from '../supabase/functions/_shared/trainingDeletionLocalStorageTransport.mjs';

assert.equal(process.env.CI,'1','Explicit disposable-local CI mode required');
assert.notEqual(process.env.ALL251_ALLOW_HOSTED_TEST,'true','Hosted fixture forbidden');
const env=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:15000,
}).split(/\r?\n/).map(s=>s.match(/^(?:export )?([A-Z_]+)=(.*)$/))
 .filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const base=new URL(env.API_URL??'');
assert.equal(base.protocol,'http:');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname));
assert.equal(base.port,'54321');
assert.equal(base.pathname,'/');
const admin=env.SERVICE_ROLE_KEY,anon=env.ANON_KEY;
assert.ok(typeof admin==='string'&&admin.length>40);
assert.ok(typeof anon==='string'&&anon.length>20);
const nonce=randomBytes(8).toString('hex');
const bucket='all251-community-photo-'+nonce;
const users=[],objects=[];
let bucketCreated=false,policyCreated=false,backupDirectory=null,accepted=false;
const containers=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{
 encoding:'utf8',timeout:15000,
}).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length,1,'Exactly one disposable Supabase DB required');
const db=containers[0];
function sql(statement){
 return execFileSync('docker',['exec','-i',db,'psql','-X','-U','postgres','-d','postgres',
  '-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8',timeout:15000});
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const encodedPath=path=>path.split('/').map(encodeURIComponent).join('/');
async function request(method,path,{key=anon,jwt=null,body,contentType}={}){
 const headers={apikey:key,Authorization:'Bearer '+(jwt??key)};
 if(body!==undefined)headers['Content-Type']=contentType??'application/json';
 return fetch(base.origin+path,{method,headers,
  body:body===undefined?undefined:contentType?body:JSON.stringify(body),
  redirect:'manual',signal:AbortSignal.timeout(15000)});
}
function chunk(type,data){
 const header=Buffer.alloc(8);header.writeUInt32BE(data.length,0);header.write(type,4,'ascii');
 const bytes=Buffer.concat([header,data]);
 let crc=0xffffffff;
 for(let i=4;i<bytes.length;i++){
  crc^=bytes[i];
  for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 const trailer=Buffer.alloc(4);trailer.writeUInt32BE((crc^0xffffffff)>>>0,0);
 return Buffer.concat([bytes,trailer]);
}
function photo(){
 const w=32,h=32;
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);
 ihdr[8]=8;ihdr[9]=2;
 const raw=Buffer.alloc(h*(1+3*w));
 for(let y=0;y<h;y++){
  for(let x=0;x<w;x++){
   const p=y*(1+3*w)+1+x*3;
   raw[p]=(x*7+y*3)%256;raw[p+1]=(x*5+y*11)%256;raw[p+2]=(x*13+y)%256;
  }
 }
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const storageTransport=createLocalDeletionStorageTransport({
 apiUrl:base.origin,serviceRoleKey:admin,
});
async function read(path,token){
 return request('GET','/storage/v1/object/authenticated/'+bucket+'/'+encodedPath(path),
  {key:anon,jwt:token});
}
try{
 for(const name of ['A','B']){
  const email='all251-photo-'+name.toLowerCase()+'-'+nonce+'@example.invalid';
  const password='A!'+randomBytes(24).toString('hex');
  const created=await request('POST','/auth/v1/admin/users',{
   key:admin,body:{email,password,email_confirm:true},
  });
  assert.ok([200,201].includes(created.status),'Disposable Auth creation failed');
  const {id}=await created.json();assert.match(id,/^[a-f0-9-]{36}$/i);
  const user={name,id,email,password};users.push(user);
  const login=await request('POST','/auth/v1/token?grant_type=password',{
   body:{email,password},
  });
  assert.equal(login.status,200,'Real local sign-in failed');
  const session=await login.json();assert.equal(session.user.id,id);
  user.token=session.access_token;
 }
 const [a,b]=users;
 const current=await request('GET','/storage/v1/bucket',{key:admin});
 assert.equal(current.status,200);
 assert.equal((await current.json()).some(item=>item.id===bucket),false,
  'Disposable bucket collision');
 const created=await request('POST','/storage/v1/bucket',{
  key:admin,body:{id:bucket,name:bucket,public:false},
 });
 assert.ok(created.ok,'Private local bucket creation failed');bucketCreated=true;
 sql(`CREATE POLICY "all251_photo_${nonce}" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id='${bucket}' AND split_part(name,'/',1)=(SELECT auth.uid()::text))`);
 policyCreated=true;

 // Synthetic post/photo identity must match the review-only canonical ledger.
 const postId=randomUUID(),photoId=randomUUID();
 const path=a.id+'/posts/'+postId+'/'+photoId+'.png';
 const bytes=photo(),expected=digest(bytes);
 backupDirectory=mkdtempSync(join(tmpdir(),'all251-community-photo-'));
 const backup=join(backupDirectory,'private-photo.png');
 writeFileSync(backup,bytes,{flag:'wx',mode:0o600});
 assert.equal(digest(readFileSync(backup)),expected);
 objects.push(path); // Track before network write so an ambiguous commit gets cleanup.
 // TEST-ONLY privileged fixture write: production accepts no Community bucket.
 const uploaded=await request('POST','/storage/v1/object/'+bucket+'/'+encodedPath(path),{
  key:admin,body:bytes,contentType:'image/png',
 });
 assert.ok(uploaded.ok,'Private fixture photo-byte upload failed');
 const ownerRead=await read(path,a.token);
 assert.equal(ownerRead.status,200,'Owner cannot download private photo');
 assert.equal(digest(Buffer.from(await ownerRead.arrayBuffer())),expected);
 const deniedB=await read(path,b.token);
 assert.ok([400,401,403,404].includes(deniedB.status),'B read A private photo');
 const anonymous=await read(path,anon);
 assert.ok([400,401,403,404].includes(anonymous.status),'Anonymous photo access');
 const verified=await storageTransport.listOwnerStorageObjects({
  ownerId:a.id,requestId:postId,bucketId:bucket,
 });
 assert.deepEqual(verified.paths,[path]);
 assert.equal(verified.exhaustive,true);

 // Preserve backup bytes and checksum before deletion; metadata alone is
 // NOT sufficient to restore image content.
 const removed=await request('DELETE','/storage/v1/object/'+bucket+'/'+encodedPath(path),
  {key:admin});
 assert.ok(removed.ok,'Fixture delete failed');
 assert.equal(await storageTransport.objectExists({
  ownerId:a.id,requestId:postId,bucketId:bucket,path,
 }),false,'Deleted photo metadata still exists');
 assert.equal(await storageTransport.objectBytesAbsent({
  ownerId:a.id,requestId:postId,bucketId:bucket,path,
 }),true,'Deleted photo bytes remain readable');
 assert.equal((await storageTransport.listOwnerStorageObjects({
  ownerId:a.id,requestId:postId,bucketId:bucket,
 })).totalCount,0,'Post-deletion owner inventory not empty');
 const recovered=readFileSync(backup);
 assert.equal(digest(recovered),expected,'Independent backup digest mismatch');
 const restored=await request('POST','/storage/v1/object/'+bucket+'/'+encodedPath(path),{
  key:admin,body:recovered,contentType:'image/png',
 });
 assert.ok(restored.ok,'Restoration to exact canonical photo path failed');
 const restoredOwn=await read(path,a.token);
 assert.equal(restoredOwn.status,200,'Restored owner photo unreadable');
 assert.equal(digest(Buffer.from(await restoredOwn.arrayBuffer())),expected,
  'Restored byte checksum differs');
 const restoredForeign=await read(path,b.token);
 assert.ok([400,401,403,404].includes(restoredForeign.status),
  'Foreign session read restored private photo');
 // Keep byte and owner deletion tests distinct from release authorization.
 accepted=true;
}finally{
 const problems=[];
 for(const path of [...objects].reverse()){
  try{
   const result=await request('DELETE','/storage/v1/object/'+bucket+'/'+encodedPath(path),{key:admin});
   if(!result.ok&&!([400,404].includes(result.status)))problems.push('object_delete');
   const checked=await storageTransport.objectBytesAbsent({
    ownerId:path.split('/')[0],requestId:path.split('/')[2],bucketId:bucket,path,
   });
   if(checked!==true)problems.push('object_bytes_remain');
  }catch{problems.push('object_cleanup');}
 }
 if(policyCreated)try{
  sql(`DROP POLICY IF EXISTS "all251_photo_${nonce}" ON storage.objects`);
 }catch{problems.push('policy_cleanup');}
 if(bucketCreated)try{
  const response=await request('DELETE','/storage/v1/bucket/'+bucket,{key:admin});
  if(!response.ok)problems.push('bucket_cleanup');
 }catch{problems.push('bucket_cleanup');}
 for(const user of [...users].reverse())try{
  const response=await request('DELETE','/auth/v1/admin/users/'+user.id,{key:admin});
  if(!response.ok)problems.push('auth_cleanup');
 }catch{problems.push('auth_cleanup');}
 if(backupDirectory)try{rmSync(backupDirectory,{recursive:true,force:true});}
 catch{problems.push('backup_cleanup');}
 assert.deepEqual(problems,[],'Disposable local photo fixture cleanup incomplete');
}

if(accepted)console.log('PASS ALL-251 local-only Community PNG bytes: A read, B/anon denied, inventory, digest, provider byte absence, independent restore and cleanup');
