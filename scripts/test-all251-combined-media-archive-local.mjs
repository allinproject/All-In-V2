/**
 * ALL-251 LOCAL ONLY: Real Supabase Auth + Storage, combined encrypted archive
 * workout series/route + Community photo, delete, restore and owner isolation.
 *
 * Disposable fixture, not a canonical DB migration or production writer.
 * Metadata is explicitly synthetic and derived from real fixture bytes;
 * separately replay the canonical PostgreSQL ledger/owner-source contracts.
 * CI=1, localhost :54321 and fresh per-run bucket names are mandatory.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createApprovedPrivateMediaPageReader} from '../supabase/functions/_shared/trainingExportPrivateMediaPages.mjs';
import {createCommunityPhotoArchivePagesReview} from '../supabase/functions/_shared/communityPhotoArchivePagesReview.mjs';
import {verifyCommunityPhotoRecoveryReview} from '../supabase/functions/_shared/communityPhotoArchiveRecoveryReview.mjs';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from '../supabase/functions/_shared/trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload} from '../supabase/functions/_shared/trainingExportDownloadVerifier.mjs';
import {createLocalDeletionStorageTransport} from '../supabase/functions/_shared/trainingDeletionLocalStorageTransport.mjs';

assert.equal(process.env.CI,'1','Disposable CI only');
assert.notEqual(process.env.ALL251_ALLOW_HOSTED_TEST,'true','Hosted forbidden');
const vars=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:15000,
}).split(/\r?\n/).map(s=>s.match(/^(?:export )?([A-Z_]+)=(.*)$/))
 .filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const url=new URL(vars.API_URL??'');
assert.equal(url.protocol,'http:');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
assert.equal(url.port,'54321');assert.equal(url.pathname,'/');
const admin=vars.SERVICE_ROLE_KEY,anon=vars.ANON_KEY;
assert.ok(typeof admin==='string'&&admin.length>40);
assert.ok(typeof anon==='string'&&anon.length>20);
const nonce=randomBytes(8).toString('hex');
const workoutBucket='v2-private-workout-objects';
const photoBucket='v2-private-community-photos';
const users=[],buckets=[],uploaded=[],policies=[];
const dbContainers=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{
 encoding:'utf8',timeout:15000,
}).trim().split(/\r?\n/).filter(Boolean);
assert.equal(dbContainers.length,1,'Exactly one disposable Supabase DB required');
const db=dbContainers[0];
function sql(statement){
 return execFileSync('docker',['exec',db,'psql','-X','-U','postgres','-d','postgres',
  '-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8',timeout:15000});
}
const sha=b=>createHash('sha256').update(b).digest('hex');
function chunk(type,data){
 const b=Buffer.alloc(8);b.writeUInt32BE(data.length,0);b.write(type,4);
 const input=Buffer.concat([b,data]);let crc=0xffffffff;
 for(let i=4;i<input.length;i++){
  crc^=input[i];for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 const tail=Buffer.alloc(4);tail.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([input,tail]);
}
function syntheticPng(){
 const width=300,height=300,ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
 ihdr[8]=8;ihdr[9]=2;
 const pixels=Buffer.alloc(height*(width*3+1));
 randomBytes(pixels.length).copy(pixels);
 for(let y=0;y<height;y++)pixels[y*(width*3+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const enc=p=>p.split('/').map(encodeURIComponent).join('/');
async function api(method,path,{key=admin,jwt=key,body,type}={}){
 const headers={apikey:key,Authorization:'Bearer '+jwt};
 if(body!==undefined)headers['Content-Type']=type??'application/json';
 return fetch(url.origin+path,{method,headers,redirect:'manual',
  body:body===undefined?undefined:type?body:JSON.stringify(body),
  signal:AbortSignal.timeout(15000)});
}
const storage=createLocalDeletionStorageTransport({apiUrl:url.origin,serviceRoleKey:admin});
async function getBytes(bucket,path){
 const r=await api('GET','/storage/v1/object/authenticated/'+bucket+'/'+enc(path));
 if(!r.ok)throw Error('Trusted local Storage read failed '+r.status);
 return new Uint8Array(await r.arrayBuffer());
}
async function ownerRead(user,bucket,path){
 return api('GET','/storage/v1/object/authenticated/'+bucket+'/'+enc(path),{
  key:anon,jwt:user.token,
 });
}
function checkedAbsent(r){
 return [400,401,403,404].includes(r.status);
}
let passed=false;
try{
 for(const suffix of ['a','b']){
  const email='all251-combined-'+suffix+'-'+nonce+'@example.invalid';
  const password='A!'+randomBytes(24).toString('hex');
  const response=await api('POST','/auth/v1/admin/users',{
   body:{email,password,email_confirm:true},
  });
  assert.ok(response.ok,'Disposable account creation failed');
  const account=await response.json();
  const u={id:account.id,email,password};users.push(u);
  const login=await api('POST','/auth/v1/token?grant_type=password',{
   key:anon,jwt:anon,body:{email,password},
  });
  assert.equal(login.status,200,'Disposable GoTrue login failed');
  const session=await login.json();assert.equal(session.user.id,u.id);
  u.token=session.access_token;
 }
 const [a,b]=users;
 const before=await storage.listBucketCatalog();
 assert(before.every(item=>![workoutBucket,photoBucket].includes(item.id)));
 for(const bucket of [workoutBucket,photoBucket]){
  const r=await api('POST','/storage/v1/bucket',{body:{id:bucket,name:bucket,public:false}});
  assert.ok(r.ok,'Private fixture bucket creation failed');
  buckets.push(bucket);
 }
 for(const bucket of [workoutBucket,photoBucket]){
  const policy='all251_combined_'+nonce+'_'+(bucket===photoBucket?'photo':'workout');
  sql(`CREATE POLICY "${policy}" ON storage.objects FOR SELECT TO authenticated
   USING(bucket_id='${bucket}' AND split_part(name,'/',1)=(SELECT auth.uid()::text))`);
  policies.push(policy);
 }
 const requestId=randomUUID(),snapshotId=randomUUID();
 const postId=randomUUID(),photoId=randomUUID();
 const seriesPath=a.id+'/series/'+randomUUID()+'.fit';
 const routePath=a.id+'/route/'+randomUUID()+'.geojson';
 const photoPath=a.id+'/posts/'+postId+'/'+photoId+'.png';
 const sources=[
  {bucket:workoutBucket,path:seriesPath,bytes:randomBytes(270000),type:'application/octet-stream'},
  {bucket:workoutBucket,path:routePath,bytes:randomBytes(180000),type:'application/json'},
  {bucket:photoBucket,path:photoPath,bytes:syntheticPng(),type:'image/png'},
 ];
 const originals=new Map(sources.map(item=>[item.path,item.bytes]));
 for(const source of sources){
  uploaded.push(source); // record before network mutation
  const r=await api('POST','/storage/v1/object/'+source.bucket+'/'+enc(source.path),{
   body:source.bytes,type:source.type,
  });
  assert.ok(r.ok,'Privileged test-only fixture byte upload failed');
  const own=await ownerRead(a,source.bucket,source.path);
  assert.equal(own.status,200,'Owner could not access approved local-only private object');
  assert.equal(sha(Buffer.from(await own.arrayBuffer())),sha(source.bytes));
  const foreign=await ownerRead(b,source.bucket,source.path);
  assert(checkedAbsent(foreign),'B accessed A private Storage object');
 }
 const bucketRows=await storage.listBucketCatalog();
 assert(buckets.every(id=>bucketRows.some(x=>x.id===id&&x.public===false)));
 const inventory=async bucketId=>storage.listOwnerStorageObjects({
  ownerId:a.id,requestId,bucketId,
 });
 const workout=await createApprovedPrivateMediaPageReader({
  ownerId:a.id,requestId,snapshotId,
  scoped:{
   listCanonicalMediaReferences:async()=>({
    ownerId:a.id,requestId,
    series:[{user_id:a.id,object_path:seriesPath,
     checksum_sha256:sha(originals.get(seriesPath)),state:'ready'}],
    routes:[{user_id:a.id,object_path:routePath,
     checksum_sha256:sha(originals.get(routePath)),state:'ready',privacy_state:'private'}],
   }),
   listBucketCatalog:async()=>[{id:workoutBucket,public:false}],
   listOwnerStorageObjects:async()=>inventory(workoutBucket),
  },
  downloadPrivateObject:async({ownerId,path,kind})=>{
   assert.equal(ownerId,a.id);
   assert.equal(kind,path===seriesPath?'series':'route');
   return getBytes(workoutBucket,path);
  },
 });
 const snapshot={ownerId:a.id,complete:true,rows:[{
  id:photoId,post_id:postId,owner_id:a.id,post_owner_id:a.id,
  post_version:1,bucket_id:'v2-private-community-photos',
  object_path:photoPath,content_type:'image/png',
  width:300,height:300,byte_length:originals.get(photoPath).length,
  sha256:sha(originals.get(photoPath)),lifecycle:'verified',
  verified_at:new Date().toISOString(),
 }]};
 const photos=await createCommunityPhotoArchivePagesReview({
  ownerId:a.id,requestId,snapshotId,
  scoped:{
   listCanonicalPostPhotos:async()=>snapshot,
   listBucketCatalog:async()=>[{id:photoBucket,public:false}],
   listOwnerStorageObjects:async()=>inventory(photoBucket),
   downloadPrivatePhoto:async args=>{
    assert.equal(args.ownerId,a.id);
    assert.equal(args.path,photoPath);
    return getBytes(photoBucket,photoPath);
   },
  },
 });
 const collections=['private_media','community.private_photos'];
 const readers={private_media:workout.readPage,'community.private_photos':photos.readPage};
 const sealed=new Map(),key=randomBytes(32);
 let manifest=null;
 const services={
  authorizeExport:async()=>({ownerId:a.id,activeSession:true,exportPermitted:true}),
  // Synthetic inventory ONLY, never an operational release receipt.
  getCanonicalInventory:async()=>({ownerId:a.id,requestId,snapshotId,
   complete:true,collections}),
  readPage:args=>readers[args.collection](args),
  resolveEncryptionKey:async()=>key,
  writePrivatePage:async({ownerId,requestId,collection,index,sealed:page})=>{
   sealed.set(collection+':'+index,page);
   return {ownerId,requestId,collection,index,stored:true};
  },
  commitPrivateManifest:async({ownerId,requestId,manifest:next})=>{
   manifest=next;return {ownerId,requestId,committed:true};
  },
  readPrivateManifest:async()=>manifest,
  readPrivatePage:async({collection,index})=>sealed.get(collection+':'+index),
  purgePrivateRequest:async()=>{sealed.clear();manifest=null;return true;},
 };
 const stage=await stageLargeAccountExport({requestId,collections,services});
 assert.equal(stage.encrypted,true);
 const result=await createLargeAccountDownloadResponse({requestId,collections,services});
 const download=await verifyAccountExportDownload({
  stream:result.clone().body,expectedOwnerId:a.id,expectedCollections:collections,
 });
 assert.equal(download.verified,true);
 const photoRecovery=await verifyCommunityPhotoRecoveryReview({
  response:result.clone(),ownerId:a.id,requestId,collections,canonicalSnapshot:snapshot,
 });
 assert.deepEqual(Buffer.from(photoRecovery.restored.get(photoPath)),originals.get(photoPath));
 assert.equal(photoRecovery.completeUserExport,false);
 const lines=(await result.text()).trimEnd().split('\n').map(JSON.parse);
 const records=lines.slice(1,-1).filter(x=>x.collection==='private_media').map(x=>x.record);
 const recovered=new Map([[photoPath,Buffer.from(photoRecovery.restored.get(photoPath))]]);
 for(const path of [seriesPath,routePath]){
  const chunks=records.filter(x=>x.path===path).sort((x,y)=>x.part-y.part);
  assert(chunks.length>0,'Missing workout archive chunks');
  assert.deepEqual(chunks.map(x=>x.part),Array.from({length:chunks.length},(_,i)=>i));
  const value=Buffer.concat(chunks.map(x=>{
   const chunk=Buffer.from(x.dataBase64,'base64');
   assert.equal(sha(chunk),x.chunkSha256);
   return chunk;
  }));
  assert.equal(sha(value),sha(originals.get(path)));
  recovered.set(path,value);
 }
 for(const source of sources){
  const r=await api('DELETE','/storage/v1/object/'+source.bucket+'/'+enc(source.path));
  assert.ok(r.ok,'Fixture Storage removal failed');
  assert.equal(await storage.objectBytesAbsent({
   ownerId:a.id,requestId,bucketId:source.bucket,path:source.path,
  }),true,'Storage bytes remained after delete');
  assert.equal((await inventory(source.bucket)).totalCount,0);
  const restored=await api('POST','/storage/v1/object/'+source.bucket+'/'+enc(source.path),{
   body:recovered.get(source.path),type:source.type,
  });
  assert(restored.ok,'Fixture Storage restore failed');
  assert.equal(sha(await getBytes(source.bucket,source.path)),sha(originals.get(source.path)));
  const restoredOwner=await ownerRead(a,source.bucket,source.path);
  assert.equal(restoredOwner.status,200,'Owner could not read restored file');
  assert.equal(sha(Buffer.from(await restoredOwner.arrayBuffer())),sha(originals.get(source.path)));
  assert(checkedAbsent(await ownerRead(b,source.bucket,source.path)),
   'B accessed restored owner object');
 }
 passed=true;
}finally{
 const errors=[];
 for(const source of [...uploaded].reverse()){
  try{
   const r=await api('DELETE','/storage/v1/object/'+source.bucket+'/'+enc(source.path));
   if(!r.ok&&r.status!==404)errors.push('object');
   const absent=await storage.objectBytesAbsent({
    ownerId:source.path.split('/')[0],requestId:randomUUID(),
    bucketId:source.bucket,path:source.path,
   });
   if(absent!==true)errors.push('remaining-bytes');
  }catch{errors.push('object-cleanup');}
 }
 for(const policy of [...policies].reverse()){
  try{sql(`DROP POLICY IF EXISTS "${policy}" ON storage.objects`);}
  catch{errors.push('policy-cleanup');}
 }
 for(const bucket of [...buckets].reverse()){
  try{const r=await api('DELETE','/storage/v1/bucket/'+bucket);
   if(!r.ok)errors.push('bucket');}catch{errors.push('bucket-cleanup');}
 }
 for(const user of [...users].reverse()){
  try{const r=await api('DELETE','/auth/v1/admin/users/'+user.id);
   if(!r.ok)errors.push('auth');}catch{errors.push('auth-cleanup');}
 }
 assert.deepEqual(errors,[],'Disposable local fixture cleanup incomplete');
}
if(passed)console.log('PASS ALL-251 local two-Auth combined encrypted workout/photo export, delete, restore, checksum and cleanup; operational gates OFF');
