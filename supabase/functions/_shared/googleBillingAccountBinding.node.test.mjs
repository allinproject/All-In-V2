import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {obfuscatedGoogleBillingAccountId as derive} from './googleBillingAccountBinding.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='00000000-0000-0000-0000-000000000001';
const pepper='server-only-test-pepper-1234567890123456789';
test('Google Billing binding is stable and does not expose account UUID',async()=>{
 const first=await derive({ownerId:owner,environment:'sandbox',serverPepper:pepper});
 const second=await derive({ownerId:owner,environment:'sandbox',serverPepper:pepper});
 assert.equal(first,second);
 assert.match(first,/^[a-f0-9]{64}$/);
 assert.equal(first.includes(owner),false);
});
test('wrong owner or production environment yields a different binding',async()=>{
 const original=await derive({ownerId:owner,environment:'sandbox',serverPepper:pepper});
 const other=await derive({ownerId:'00000000-0000-0000-0000-000000000002',
 environment:'sandbox',serverPepper:pepper});
 const production=await derive({ownerId:owner,environment:'production',serverPepper:pepper});
 assert.notEqual(original,other);
 assert.notEqual(original,production);
});
test('former four-group pseudo-UUID never derives a billing account binding',async()=>{
 assert.equal(await derive({ownerId:'00000000-0000-0000-000000000001',
  environment:'sandbox',serverPepper:pepper}),null);
 assert.match(await derive({ownerId:owner,
  environment:'sandbox',serverPepper:pepper}),/^[a-f0-9]{64}$/);
});
test('no weak, missing, or client-derived configuration is accepted',async()=>{
 for(const options of [
  {ownerId:owner,environment:'sandbox',serverPepper:''},
  {ownerId:owner,environment:'sandbox',serverPepper:'short'},
  {ownerId:'not-valid',environment:'sandbox',serverPepper:pepper},
  {ownerId:owner,environment:'unknown',serverPepper:pepper},
 ]){
  assert.equal(await derive(options),null);
 }
});
