import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAppleStoreTransaction as verify} from './appleStoreTransactionVerification.mjs';
const owner='00000000-0000-0000-0000-000000000001';
const now=1794410000000;
const signedTransaction='eyJhbGciOiJFUzI1NiJ9.eyJleGFtcGxlIjoidHJ1ZSJ9.c2lnbmF0dXJl';
const transaction={bundleId:'com.allin365.app',environment:'Sandbox',
 productId:'allin365.monthly',type:'Auto-Renewable Subscription',
 originalTransactionId:'123456789012',transactionId:'123456789013',
 appAccountToken:owner,expiresDate:now+86400000,purchaseDate:now-1000};
const base=()=>({signedTransaction,expectedBundleId:'com.allin365.app',
 expectedProductId:'allin365.monthly',expectedEnvironment:'Sandbox',
 expectedAccountToken:owner,nowMs:now,verifySignedJws:async()=>transaction});
const run=override=>verify({...base(),...override});
test('trusted verified JWS may create owner-bound candidate, not entitlement',async()=>{
 const r=await run();
 assert.equal(r.status,'verified_for_owner_binding');
 assert.equal(r.providerSubscriptionId,'123456789012');
 assert.equal(r.currentStatusCheckRequired,true);
 assert.equal(r.accessUntil,now+86400000);
 assert.equal('entitled' in r,false);
});
test('tampered signature, missing verifier and malformed JWS rejected',async()=>{
 assert.equal((await run({verifySignedJws:async()=>{throw Error('tamper')}})).status,'signature_invalid');
 assert.equal((await run({verifySignedJws:null})).status,'invalid_request');
 assert.equal((await run({signedTransaction:'not.a.valid.signature'})).status,'invalid_request');
});
test('different app, account, SKU or environment never binds',async()=>{
 for(const patch of [{bundleId:'com.other.app'},{appAccountToken:'00000000-0000-0000-0000-000000000002'},
 {productId:'allin365.annual'},{environment:'Production'},
 {originalTransactionId:'untrusted'},{type:'Consumable'}]){
  assert.equal((await run({verifySignedJws:async()=>({...transaction,...patch})})).status,
   'unverified_provider_state');
 }
});
test('expired and revoked transactions never yield future access',async()=>{
 const expired=await run({verifySignedJws:async()=>({...transaction,expiresDate:now-1})});
 assert.equal(expired.phase,'expired');assert.equal(expired.accessUntil,null);
 const revoked=await run({verifySignedJws:async()=>({...transaction,revocationDate:now-100})});
 assert.equal(revoked.phase,'revoked');assert.equal(revoked.accessUntil,null);
});
