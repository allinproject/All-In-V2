import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyStripeSandboxWebhook as verify} from './stripeWebhookVerification.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const key='whsec_mockSecret123';
const now=1794410000;
const event={id:'evt_test_123',object:'event',created:now,livemode:false,
 type:'customer.subscription.updated',data:{object:{id:'sub_test_123',
  customer:'cus_private',metadata:{ownerId:'attacker'}}}};
const enc=new TextEncoder();
async function signed(payload=event,{timestamp=now,secret=key}={}){
 const bytes=typeof payload==='string'?enc.encode(payload):enc.encode(JSON.stringify(payload));
 const hmacKey=await crypto.subtle.importKey('raw',enc.encode(secret),
   {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const prefix=enc.encode(timestamp+'.');
 const contents=new Uint8Array(prefix.length+bytes.length);
 contents.set(prefix);contents.set(bytes,prefix.length);
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',hmacKey,contents));
 const signature=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
 return {rawBody:bytes,signatureHeader:'t='+timestamp+',v1='+signature,
   webhookSecrets:[key],nowSeconds:now};
}
test('signed sandbox event yields only a notification and no owner or entitlement',async()=>{
 const result=await verify(await signed());
 assert.deepEqual(result,{status:'verified_notification',
   eventId:'evt_test_123',eventType:'customer.subscription.updated',
   objectId:'sub_test_123'});
 assert.equal('ownerId' in result,false);
 assert.equal('entitlement' in result,false);
});
test('tampering and wrong key reject signature',async()=>{
 const valid=await signed();
 assert.equal((await verify({...valid,rawBody:enc.encode('{}')})).status,'invalid_signature');
 assert.equal((await verify({...valid,webhookSecrets:['whsec_other123']})).status,'invalid_signature');
 assert.equal((await verify({...valid,signatureHeader:'t='+now+',v1='+'0'.repeat(64)})).status,
   'invalid_signature');
});
test('expiry, future timestamp, and missing signature deny replay',async()=>{
 for(const timestamp of [now-301,now+301]){
   assert.equal((await verify(await signed(event,{timestamp}))).status,'invalid_signature');
 }
 const valid=await signed();
 assert.equal((await verify({...valid,signatureHeader:'t='+now})).status,'invalid_signature');
 assert.equal((await verify({...valid,signatureHeader:valid.signatureHeader+',t='+now})).status,
   'invalid_signature');
});
test('key rotation supports matching one of several configured secrets',async()=>{
 const data=await signed(event,{secret:'whsec_rotated456'});
 assert.equal((await verify({...data,webhookSecrets:[key,'whsec_rotated456']})).status,
   'verified_notification');
});
test('malformed JSON or live events never become authoritative',async()=>{
 assert.equal((await verify(await signed('{broken json'))).status,'invalid_event');
 assert.equal((await verify(await signed({...event,livemode:true}))).status,'invalid_event');
 assert.equal((await verify(await signed({...event,data:{object:{id:'cs_wrong'}}}))).status,
   'invalid_event');
});
test('unrelated signed events are ignored; missing secrets fail closed',async()=>{
 assert.equal((await verify(await signed({...event,type:'customer.created'}))).status,
   'ignored_event');
 const valid=await signed();
 assert.equal((await verify({...valid,webhookSecrets:[]})).status,'invalid_envelope');
 assert.equal((await verify({...valid,rawBody:new Uint8Array()})).status,'invalid_envelope');
 assert.equal((await verify({...valid,rawBody:new Uint8Array(256*1024+1)})).status,
   'invalid_envelope');
});
