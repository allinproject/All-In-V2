import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocalDeletionStorageTransport} from '../supabase/functions/_shared/trainingDeletionLocalStorageTransport.mjs';

const A='a1111111-a111-4111-8111-a11111111111';
const B='b2222222-b222-4222-8222-b22222222222';
const R='c3333333-c333-4333-8333-c33333333333';
const bucket='v2-private-workout-objects';
const key='x'.repeat(50);
function mockFixture() {
 const files=new Set([...Array.from({length:103},(_,i)=>A+'/sensor-'+String(i).padStart(3,'0')+'.fit'),
  A+'/nested/route.geojson',B+'/keep.bin']);
 const calls=[];
 let failDelete=false, forbiddenInfo=false;
 const stub=async(url,{method,headers,body})=>{
  assert.equal(headers.Authorization,'Bearer '+key);
  assert.equal(headers.apikey,key);
  const path=new URL(url).pathname.replace(/^\/storage\/v1/,'');
  calls.push({method,path});
  const reply=(status,data)=>({status,json:async()=>data});
  if(path==='/bucket'&&method==='GET')
   return reply(200,[{id:bucket,public:false}]);
  if(path==='/object/list/'+bucket&&method==='POST'){
   const {prefix,offset,limit}=JSON.parse(body);
   assert.equal(limit,100);
   const children=new Map();
   for(const p of files){
    if(!p.startsWith(prefix+'/'))continue;
    const part=p.slice(prefix.length+1).split('/')[0];
    const full=prefix+'/'+part;
    children.set(part,{name:part,id:files.has(full)?'obj-'+part:null});
   }
   return reply(200,[...children.values()].sort((a,b)=>a.name.localeCompare(b.name))
    .slice(offset,offset+limit));
  }
  const info='/object/info/'+bucket+'/';
  const deletion='/object/'+bucket+'/';
  const isInfo=path.startsWith(info)&&method==='GET';
  const isDelete=path.startsWith(deletion)&&method==='DELETE';
  if(isInfo||isDelete){
   const name=decodeURIComponent(path.slice((isInfo?info:deletion).length));
   if(isInfo&&forbiddenInfo)return reply(403,{message:'denied'});
   if(isDelete&&failDelete)return reply(503,{message:'temporary'});
   if(!files.has(name))return reply(404,{message:'not found'});
   if(isDelete)files.delete(name);
   return reply(200,{});
  }
  throw Error('Unexpected Storage API request '+method+' '+path);
 };
 return {files,calls,
  setFailDelete:v=>failDelete=v,setForbiddenInfo:v=>forbiddenInfo=v,
  client:createLocalDeletionStorageTransport({
   apiUrl:'http://127.0.0.1:54321',serviceRoleKey:key,fetchImpl:stub,
  })};
}
test('local Storage transport inventories all owner pages and nested folders',async()=>{
 const f=mockFixture();
 const result=await f.client.listOwnerStorageObjects({ownerId:A,requestId:R,bucketId:bucket});
 assert.equal(result.exhaustive,true);
 assert.equal(result.totalCount,104);
 assert.equal(new Set(result.paths).size,104);
 assert.ok(result.paths.includes(A+'/nested/route.geojson'));
 assert.ok(!result.paths.includes(B+'/keep.bin'));
 assert.ok(f.calls.filter(c=>c.path==='/object/list/'+bucket).length>=3);
});
test('only scoped owner path can be deleted and B bytes remain',async()=>{
 const f=mockFixture();
 const owned=A+'/sensor-000.fit',foreign=B+'/keep.bin';
 await assert.rejects(f.client.deleteObject({ownerId:A,requestId:R,bucketId:bucket,path:foreign}),/foreign/);
 assert.equal(await f.client.objectExists({ownerId:A,requestId:R,bucketId:bucket,path:owned}),true);
 assert.deepEqual(await f.client.deleteObject({ownerId:A,requestId:R,bucketId:bucket,path:owned}),{deleted:true});
 assert.equal(await f.client.objectExists({ownerId:A,requestId:R,bucketId:bucket,path:owned}),false);
 assert.deepEqual(await f.client.deleteObject({ownerId:A,requestId:R,bucketId:bucket,path:owned}),{alreadyAbsent:true});
 assert.ok(f.files.has(foreign));
});
test('authorization and 5xx are never treated as object absence',async()=>{
 const f=mockFixture();
 f.setForbiddenInfo(true);
 await assert.rejects(f.client.objectExists({ownerId:A,requestId:R,bucketId:bucket,path:A+'/sensor-000.fit'}),/could not be verified/);
 f.setFailDelete(true);
 await assert.rejects(f.client.deleteObject({ownerId:A,requestId:R,bucketId:bucket,path:A+'/sensor-000.fit'}),/Transient/);
 assert.ok(f.files.has(A+'/sensor-000.fit'));
});
test('never accept hosted endpoint, client key, or malformed paths',async()=>{
 assert.throws(()=>createLocalDeletionStorageTransport({
  apiUrl:'https://project.supabase.co',serviceRoleKey:key,fetchImpl:async()=>{},
 }),/local-only/);
 assert.throws(()=>createLocalDeletionStorageTransport({
  apiUrl:'http://127.0.0.1:54321',serviceRoleKey:'short',fetchImpl:async()=>{},
 }),/local-only/);
 const f=mockFixture();
 await assert.rejects(f.client.objectExists({
  ownerId:A,requestId:R,bucketId:bucket,path:A+'/../bad',
 }),/foreign or malformed/);
 await assert.rejects(f.client.deleteObject({
  ownerId:A,requestId:'invalid',bucketId:bucket,path:A+'/safe',
 }),/Exact Storage delete scope/);
});
