import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createAccountExportKeyLease} from './trainingExportKeyLease.mjs';
const ownerId='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
function fixture(options={}){
 let reads=0,unwraps=0;
 let state={ownerId,requestId,status:'approved',cancelled:false,activeSession:true,
  keyPurpose:'account-export-v2',keyVersion:1,kmsKeyId:'kms://staging/export-master-v1',
  wrappedDataKey:'base64-mock-encrypted-key-for-isolated-tests',
  expiresAt:new Date(Date.now()+3600_000).toISOString(),...options};
 const secret=randomBytes(32),events=[];
 return {
  deps:{
   readApprovedRequestKeyLease:async()=>{
    reads++;events.push('read');
    return options.revokeDuringUnwrap&&reads>1?{...state,cancelled:true}:
      options.rotateDuringUnwrap&&reads>1?{...state,keyVersion:2}:state;
   },
   unwrapDataKey:async({context,keyVersion,purpose})=>{
    unwraps++;events.push('unwrap');
    assert.deepEqual(context,{ownerId,requestId});
    assert.equal(keyVersion,1);assert.equal(purpose,'account-export-v2');
    return options.wrongKeyLength?randomBytes(31):secret;
   },
  },
  events,secret,get reads(){return reads},get unwraps(){return unwraps},
 };
}
test('approved 256-bit key requires lease checks before and after unwrap',async()=>{
 const f=fixture();
 const result=await createAccountExportKeyLease(f.deps).resolveEncryptionKey({ownerId,requestId});
 assert.deepEqual(result,f.secret);assert.deepEqual(f.events,['read','unwrap','read']);
});
test('foreign owner or request cannot unwrap',async()=>{
 for(const args of [{ownerId:other,requestId},{ownerId,requestId:other},{ownerId:'fake',requestId}]){
  const f=fixture();
  await assert.rejects(createAccountExportKeyLease(f.deps).resolveEncryptionKey(args),/denied|required/);
  assert.equal(f.unwraps,0);
 }
});
test('inactive session, cancelled, expired, wrong purpose or long lease denied',async()=>{
 for(const change of [{activeSession:false},{cancelled:true},{status:'pending'},
  {keyPurpose:'community'},{keyVersion:0},
  {expiresAt:new Date(Date.now()-1000).toISOString()},
  {expiresAt:new Date(Date.now()+48*3600_000).toISOString()}]){
  const f=fixture(change);
  await assert.rejects(createAccountExportKeyLease(f.deps).resolveEncryptionKey({ownerId,requestId}),/denied/);
  assert.equal(f.unwraps,0);
 }
});
test('rotation or revocation during unwrap denies release',async()=>{
 for(const change of [{rotateDuringUnwrap:true},{revokeDuringUnwrap:true}]){
  const f=fixture(change);
  await assert.rejects(createAccountExportKeyLease(f.deps).resolveEncryptionKey({ownerId,requestId}),/changed/);
  assert.equal(f.unwraps,1);assert.equal(f.reads,2);
  assert(f.secret.every(b=>b===0),'Unwrapped data key must be wiped after gate revocation');
 }
});
test('invalid KMS return and missing provider denied',async()=>{
 const f=fixture({wrongKeyLength:true});
 await assert.rejects(createAccountExportKeyLease(f.deps).resolveEncryptionKey({ownerId,requestId}),/Invalid server KMS data key/);
 assert.throws(()=>createAccountExportKeyLease(),/Trusted/);
});
