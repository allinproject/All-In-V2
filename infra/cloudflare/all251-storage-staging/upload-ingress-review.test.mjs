import test from 'node:test';
import assert from 'node:assert/strict';
import {createAll251UploadIngressReview,readAll251BoundedBody} from './upload-ingress-review.mjs';

const ID='33333333-3333-4333-8333-333333333333';
const URL='https://allin365-storage-staging.durbenventures.workers.dev/v1/workouts/'+ID;
const bytes=new Uint8Array([1,2,3,4,5]);
function req({method='POST',url=URL,body=bytes,headers={}}={}){
 return new Request(url,{method,
  ...(method==='GET'||method==='HEAD'?{}:{body}),
  ...(body instanceof ReadableStream?{duplex:'half'}:{}),
  headers:{'content-type':'application/octet-stream',...headers}});
}
function handler({verified=true}={}){
 const calls=[];
 const fn=createAll251UploadIngressReview({internalWriter:{
  async writeNewObjectFromVerifiedRequest(args){
   calls.push(args);
   const data=await args.loadBytes();
   return {verified:verified&&data.byteLength>0};
  },
 }});
 return {fn,calls};
}

test('only an exact object-ID POST route may enter the canonical writer',async()=>{
 const f=handler();
 for(const method of ['GET','HEAD','PUT','PATCH','DELETE','OPTIONS']){
  const response=await f.fn(req({method,body:null}));
  assert.equal(response.status,405);
 }
 for(const url of [
  URL+'?upsert=true',URL+'/suffix',
  'https://worker.example/v1/workouts/not-a-uuid',
  'https://worker.example/v1/exports/'+ID,
 ]){
  assert.equal((await f.fn(req({url}))).status,404);
 }
 assert.equal(f.calls.length,0);
});

test('success reads bytes via bounded loader and never accepts owner or path',async()=>{
 const f=handler();
 const response=await f.fn(req());
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{code:'CREATED'});
 assert.equal(f.calls.length,1);
 assert.deepEqual(Object.keys(f.calls[0]).sort(),
  ['contentType','loadBytes','objectId','request']);
 assert.equal(f.calls[0].objectId,ID);
 assert.equal(f.calls[0].contentType,'application/octet-stream');
 assert.equal(response.headers.get('cache-control'),'no-store');
});

test('unauthorized sessions are denied BEFORE calling loadBytes',async()=>{
 let readCount=0;
 const f=createAll251UploadIngressReview({internalWriter:{
  async writeNewObjectFromVerifiedRequest({loadBytes}){
   // Simulate the canonical inner writer checking Auth first.
   assert.equal(typeof loadBytes,'function');
   throw Error('AUTH_DENIED');
  },
 }});
 // A hand-built request fixture proves the handler does not touch the
 // stream. Native Request may eagerly pull during construction.
 const requestObject={
  method:'POST',url:URL,
  headers:new Headers({'content-type':'application/octet-stream'}),
  body:{getReader(){readCount++;throw Error('body read before Auth');}},
 };
 const response=await f(requestObject);
 assert.equal(response.status,401);
 assert.equal(readCount,0);
});

test('unverified canonical receipts never turn into successful uploads',async()=>{
 const f=handler({verified:false});
 assert.equal((await f.fn(req())).status,503);
});

test('oversized declared and actual streams fail without calling provider',async()=>{
 const f=handler();
 const declared=await f.fn(req({headers:{'content-length':'8388609'}}));
 assert.equal(declared.status,413);
 assert.equal(f.calls.length,0);
 const huge=new Uint8Array(8*1024*1024+1);
 const streamed=await f.fn(req({body:huge}));
 assert.equal(streamed.status,413);
});

test('missing/unsupported encoding and empty bodies denied',async()=>{
 const f=handler();
 for(const headers of [
  {'content-type':'application/json'},
  {'content-encoding':'gzip'},
 ]){
  assert.equal((await f.fn(req({headers}))).status,415);
 }
 const empty=await f.fn(req({body:new Uint8Array(0)}));
 assert.equal(empty.status,400);
});

test('truncated body is rejected even if its byte buffer is otherwise valid',async()=>{
 const response=req({body:bytes,headers:{'content-length':'6'}});
 await assert.rejects(readAll251BoundedBody(response),/PAYLOAD_MISMATCH/);
});

test('malformed request and writer exceptions never leak credentials or paths',async()=>{
 const f=createAll251UploadIngressReview({internalWriter:{
  async writeNewObjectFromVerifiedRequest(){
   throw Error('secret SUPABASE_SERVICE_ROLE allin365-private-staging');
  },
 }});
 const response=await f(req());
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{code:'STORAGE_NOT_READY'});
});

test('no internal writer means no ingress can be constructed',()=>{
 assert.throws(()=>createAll251UploadIngressReview({internalWriter:null}),
  /CANONICAL_WRITER_REQUIRED/);
});
