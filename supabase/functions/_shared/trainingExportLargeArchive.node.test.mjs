import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {stageLargeAccountExport,streamLargeAccountExport} from './trainingExportLargeArchive.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const another='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const collections=['coach_messages','completed_activities'];
function fixture(config={}){
 const key=randomBytes(32), stored=new Map(),events=[];let manifest=null,authCalls=0,purges=0;
 const data=config.data??{
  coach_messages:Array.from({length:250},(_,i)=>({id:i,owner,content:'X'.repeat(24000)})),
  completed_activities:[{id:'activity',owner}]};
 const services={
  authorizeExport:async()=>{authCalls++;events.push('authorize');
   const active=!(config.revokeAfter&&authCalls>=config.revokeAfter);
   return {ownerId:config.owner??owner,activeSession:active,exportPermitted:active};},
  resolveEncryptionKey:async()=>key,
  readPage:async({ownerId,collection,cursor})=>{
   if(config.badCursor)return {ownerId,collection,rows:[{id:1}],done:false,nextCursor:'same'};
   const start=cursor===null?0:Number(cursor),rows=data[collection]?.slice(start,start+30)??[];
   return {ownerId:config.pageOwner??owner,collection,rows,done:start+30>=data[collection].length,
    nextCursor:start+30>=data[collection].length?null:String(start+30)};},
  writePrivatePage:async({ownerId,requestId:rid,collection,index,sealed})=>{
   events.push('write');stored.set(collection+'/'+index,sealed);
   return {ownerId,requestId:rid,collection,index,stored:true};},
  commitPrivateManifest:async({ownerId,requestId:rid,manifest:m})=>{
   events.push('commit');manifest=m;return config.badCommit?null:{ownerId,requestId:rid,committed:true};},
  readPrivateManifest:async()=>config.overrideManifest??manifest,
  readPrivatePage:async({collection,index})=>{
   events.push('read');return config.corrupt?
    {...stored.get(collection+'/'+index),ciphertext:'AAAA'}:stored.get(collection+'/'+index);},
  purgePrivateRequest:async()=>{purges++;stored.clear();manifest=null;return config.purgeFails?false:true;},
 };
 return {services,events,key,stored,get manifest(){return manifest;},
  get purges(){return purges;},get authCalls(){return authCalls;}};
}
async function collect(requestId,services,collectionList=collections){
 const chunks=[];
 for await(const part of streamLargeAccountExport({requestId,collections:collectionList,services}))chunks.push(part);
 return Buffer.concat(chunks).toString('utf8');
}
test('exports >5MB of owner history in bounded encrypted pages and streams exact records',async()=>{
 const f=fixture();
 const receipt=await stageLargeAccountExport({requestId,collections,services:f.services});
 assert.equal(receipt.staged,true);
 assert.equal(receipt.completeUserExport,true);
 assert.equal(receipt.downloadAuthorized,false);
 assert(receipt.pageCount>2);
 assert(f.stored.size>2);
 assert(!JSON.stringify(receipt).includes('X'.repeat(100)));
 assert(!JSON.stringify(f.manifest).includes('X'.repeat(100)));
 const output=await collect(requestId,f.services);
 assert(Buffer.byteLength(output)>5*1024*1024);
 const lines=output.trimEnd().split('\n').map(line=>JSON.parse(line));
 assert.equal(lines[0].records,251);
 assert.equal(lines.length,252);
 assert.equal(lines[1].collection,'coach_messages');
 assert.equal(lines.at(-1).collection,'completed_activities');
 assert(f.authCalls>receipt.pageCount+3);
 assert.equal(f.purges,0);
});
test('cross-owner Auth mismatch rejects before any page reads or writes',async()=>{
 const f=fixture({pageOwner:another});
 await assert.rejects(stageLargeAccountExport({requestId,collections,services:f.services}),/Invalid canonical account export page/);
 assert.equal(f.events.includes('write'),false);
});
test('staging cancellation after partial private writes purges request, never commits',async()=>{
 const f=fixture({revokeAfter:4});
 await assert.rejects(stageLargeAccountExport({requestId,collections,services:f.services}),/revoked/);
 assert.equal(f.manifest,null);
 assert.equal(f.stored.size,0);
 assert.equal(f.purges,1);
});
test('ambiguous cleanup cannot claim success',async()=>{
 const f=fixture({badCommit:true,purgeFails:true});
 await assert.rejects(stageLargeAccountExport({requestId,collections,services:f.services}),/manual purge required/);
 assert.equal(f.events.includes('commit'),true);
});
test('tampered ciphertext never yields its plaintext',async()=>{
 const f=fixture({corrupt:true});
 await stageLargeAccountExport({requestId,collections,services:f.services});
 await assert.rejects(collect(requestId,f.services),/(authenticate data|page checksum|Invalid page)/i);
});
test('request revocation during download stops before subsequent pages',async()=>{
 const f=fixture();
 await stageLargeAccountExport({requestId,collections,services:f.services});
 let checks=0;
 const original=f.services.authorizeExport;
 f.services.authorizeExport=async (...args)=>{
  const r=await original(...args);
  checks++;
  return checks>=3?{...r,activeSession:false}:r;
 };
 await assert.rejects(collect(requestId,f.services),/revoked/);
 assert(f.events.filter(x=>x==='read').length< f.manifest.pages.length);
});
test('incomplete manifest, wrong collection contract and invalid cursor fail closed',async()=>{
 const f=fixture();
 await stageLargeAccountExport({requestId,collections,services:f.services});
 await assert.rejects(collect(requestId,f.services,['coach_messages']),/Unverified/);
 const m={...f.manifest,pages:[...f.manifest.pages].slice(1)};
 const spoof=fixture({data:{coach_messages:[],completed_activities:[]},overrideManifest:m});
 await assert.rejects(collect(requestId,spoof.services),/Unverified|Incomplete|Missing/);
 const cursor=fixture({badCursor:true});
 await assert.rejects(stageLargeAccountExport({requestId,collections,services:cursor.services}),/Unstable/);
 assert.equal(cursor.purges,1);
});
