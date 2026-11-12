/**
 * ALL-251 disposable LOCAL Supabase Storage end-to-end acceptance.
 * Never touches a hosted project. Requires CI=1, local CLI status and loopback
 * API; creates/removes fixed temporary private buckets in freshly reset CI.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createApprovedPrivateMediaPageReader} from '../supabase/functions/_shared/trainingExportPrivateMediaPages.mjs';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from '../supabase/functions/_shared/trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload} from '../supabase/functions/_shared/trainingExportDownloadVerifier.mjs';

if(!['1','true'].includes(process.env.CI??''))
 throw Error('Storage acceptance is limited to disposable CI');
const envText=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:15000});
const vars=Object.fromEntries(envText.split(/\r?\n/).map(x=>x.trim())
 .filter(x=>/^[A-Z_]+=/.test(x))
 .map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).replace(/^["']|["']$/g,'')];}));
const url=new URL(vars.API_URL??'');
if(!['localhost','127.0.0.1','::1'].includes(url.hostname)
 ||url.protocol!=='http:'||url.port!=='54321'
 ||typeof vars.SERVICE_ROLE_KEY!=='string'||vars.SERVICE_ROLE_KEY.length<40)
 throw Error('Not an approved disposable localhost Supabase target');
const owner='a1111111-a111-4111-8111-a11111111111';
const requestId='a2222222-a222-4222-8222-a22222222222';
const snapshotId='a3333333-a333-4333-8333-a33333333333';
const sourceBucket='v2-private-workout-objects';
const archiveBucket='v2-private-account-exports';
const sha=b=>createHash('sha256').update(b).digest('hex');
const series=randomBytes(330000),route=randomBytes(180000);
const p1=owner+'/'+ 'a'.repeat(64)+'/sensor.fit';
const p2=owner+'/'+ 'b'.repeat(64)+'/route.geojson';
const original=new Map([[p1,series],[p2,route]]);
const insertedBuckets=[];const uploaded=[];
function encPath(p){return p.split('/').map(encodeURIComponent).join('/');}
async function api(method,path,{data,body,token=vars.SERVICE_ROLE_KEY,contentType='application/json',ok=true}={}){
 const headers={apikey:token,authorization:'Bearer '+token};
 let payload=body;
 if(data!==undefined){payload=JSON.stringify(data);headers['Content-Type']='application/json';}
 else if(body!==undefined)headers['Content-Type']=contentType;
 const res=await fetch(url.origin+'/storage/v1'+path,{method,headers,body:payload});
 if(ok&&!res.ok)throw Error('Local Storage '+method+' '+path+' failed with HTTP '+res.status+
  ' '+(await res.text()).slice(0,180));
 return res;
}
async function sourceCatalog(){
 const container=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n')[0];
 if(!container)throw Error('Disposable PostgreSQL container unavailable');
 const sql="SELECT coalesce(json_agg(name ORDER BY name),'[]'::json)::text "+
  "FROM storage.objects WHERE bucket_id='"+sourceBucket+"' AND name LIKE '"+owner+"/%'";
 const value=execFileSync('docker',['exec',container,'psql','-X','-U','postgres','-d','postgres','-At','-c',sql],
  {encoding:'utf8',timeout:15000}).trim();
 return JSON.parse(value);
}
async function removeAll(){
 // Only remove objects/buckets that THIS fixture successfully created.
 for(const [bucket,path] of uploaded.reverse()){
  const r=await api('DELETE','/object/'+bucket+'/'+encPath(path),{ok:false});
  if(!r.ok)throw Error('Local private Storage fixture cleanup failed');
 }
 for(const bucket of insertedBuckets.reverse()){
  const r=await api('DELETE','/bucket/'+bucket,{ok:false});
  if(!r.ok)throw Error('Local Storage bucket cleanup failed');
 }
}
try{
 const existing=await api('GET','/bucket');
 const buckets=await existing.json();
 if(!Array.isArray(buckets)||buckets.some(b=>[sourceBucket,archiveBucket].includes(b.id)))
  throw Error('Disposable Storage fixture buckets already exist');
 for(const id of [sourceBucket,archiveBucket]){
  await api('POST','/bucket',{data:{id,name:id,public:false}});
  insertedBuckets.push(id);
 }
 for(const [path,bytes] of original){
  await api('POST','/object/'+sourceBucket+'/'+encPath(path),{
   body:bytes,contentType:'application/octet-stream',
  });
  uploaded.push([sourceBucket,path]);
 }
 const blocked=await api('GET','/object/authenticated/'+sourceBucket+'/'+encPath(p1),{
  token:vars.ANON_KEY??'',ok:false,
 });
 assert([400,401,403,404].includes(blocked.status),
  'Unauthenticated public Storage client read private object');
 const objectPaths=await sourceCatalog();
 assert.deepEqual(objectPaths.sort(),[p1,p2].sort());
 const refs={
  ownerId:owner,requestId,
  series:[{user_id:owner,object_path:p1,checksum_sha256:sha(series)}],
  routes:[{user_id:owner,object_path:p2,checksum_sha256:sha(route)}],
 };
 const downloadPrivateObject=async({ownerId,path,kind})=>{
  if(ownerId!==owner||!original.has(path)
   ||kind!==(path===p1?'series':'route'))throw Error('Unapproved owner evidence');
  const r=await api('GET','/object/authenticated/'+sourceBucket+'/'+encPath(path));
  return new Uint8Array(await r.arrayBuffer());
 };
 const scoped={
  listBucketCatalog:async()=>await (await api('GET','/bucket')).json(),
  listCanonicalMediaReferences:async()=>refs,
  listOwnerStorageObjects:async({ownerId,bucketId})=>({
   ownerId,requestId,bucketId,exhaustive:true,
   totalCount:objectPaths.length,paths:objectPaths,
  }),
 };
 const media=await createApprovedPrivateMediaPageReader({
  ownerId:owner,requestId,snapshotId,scoped,downloadPrivateObject,
 });
 const key=randomBytes(32),collections=['private_media'];
 const root=owner+'/'+requestId+'/';
 let manifest=null;
 async function put(name,content){
  await api('POST','/object/'+archiveBucket+'/'+encPath(root+name),{
   body:Buffer.from(JSON.stringify(content)),contentType:'application/octet-stream',
  });
  uploaded.push([archiveBucket,root+name]);
 }
 async function get(name){
  const response=await api('GET','/object/authenticated/'+archiveBucket+'/'+encPath(root+name));
  return response.json();
 }
 const services={
  authorizeExport:async()=>({ownerId:owner,activeSession:true,exportPermitted:true}),
  getCanonicalInventory:async()=>({
   ownerId:owner,requestId,snapshotId,complete:true,collections,
  }),
  readPage:media.readPage,resolveEncryptionKey:async()=>key,
  writePrivatePage:async({ownerId,requestId:rid,collection,index,sealed})=>{
   await put('pages/'+collection+'_'+index+'.json',sealed);
   return {ownerId,requestId:rid,collection,index,stored:true};
  },
  commitPrivateManifest:async({ownerId,requestId:rid,manifest:m})=>{
   await put('manifest.json',m);manifest=m;
   return {ownerId,requestId:rid,committed:true};
  },
  readPrivateManifest:async()=>get('manifest.json'),
  readPrivatePage:async({collection,index})=>get('pages/'+collection+'_'+index+'.json'),
  purgePrivateRequest:async()=>false,
 };
 const result=await stageLargeAccountExport({requestId,collections,services});
 assert.equal(result.recordCount,media.totalChunkCount);
 assert.equal(result.encrypted,true);
 assert.equal(manifest.completeUserExport,true);
 const response=await createLargeAccountDownloadResponse({requestId,collections,services});
 const copy=response.clone();
 const verified=await verifyAccountExportDownload({
  stream:response.body,expectedOwnerId:owner,expectedCollections:collections,
 });
 assert.equal(verified.verified,true);
 const rows=(await copy.text()).trimEnd().split('\n').slice(1,-1)
  .map(x=>JSON.parse(x)).filter(x=>x.collection==='private_media')
  .map(x=>x.record);
 for(const [path,bytes] of original){
  const parts=rows.filter(r=>r.path===path).sort((a,b)=>a.part-b.part);
  assert(parts.length>0&&parts.length===parts[0].parts);
  assert.deepEqual(Buffer.concat(parts.map(p=>Buffer.from(p.dataBase64,'base64'))),bytes);
 }
 console.log('PASS ALL-251: real disposable Supabase private Storage upload, anon deny, encrypted media archive readback and byte-for-byte recovery');
}finally{
 await removeAll();
}
