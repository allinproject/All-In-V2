import test from 'node:test';
import assert from 'node:assert/strict';
import {createCertifiedDevicePostgresAdapter} from './certifiedDevicePostgresAdapter.ts';
import {ingestVerifiedDeviceEnvelopeTransactional,signInternalDeviceEnvelope}
 from './certifiedDeviceIngestServer.ts';

const owner='11111111-1111-4111-8111-111111111111';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now=1770000000000,secret='staged-internal-HMAC-key-at-least-32-bytes';
const bearer='authenticated-bearer-token-fixture';
const fingerprint='a'.repeat(64);
const payload={verifiedByProviderAdapter:true,
 identity:{ownerId:owner,provider:'supported_equipment',
  sourceKind:'device_session',sourceRecordId:'trainer-42',
  revision:'1',payloadFingerprint:fingerprint,certifiedSessionInstanceId:null},
 source:{activityId:activity,ownerId:owner,sourceId:source,
  sourceQuality:'trusted',provider:'supported_equipment',certifiedByServer:true},
 observations:[{metricCode:'draft_metric',definitionVersion:1,
  measurementKind:'source_measured',valueNumeric:121,valueText:null,
  valueBoolean:null,sampleQuality:'partial',sourcePayloadHash:fingerprint}]};
function dbFixture(){
 const db={sessionActive:true,deviceRegistered:true,ownerRegistered:true,
  operator:'allin_v2_ingest_operator_test',superuser:false,revokedAt:null,
  receipt:new Map(),metric:new Map(),writes:0,commits:0,rollbacks:0,queries:[]};
 const sql={begin:async cb=>{
  const receipts=new Map(db.receipt),metrics=new Map(db.metric);
  const tx={unsafe:async(q,params=[])=>{
   db.queries.push({q,params});
   if(q.includes('SELECT current_user AS name'))return [{
    name:db.operator,rolsuper:db.superuser,rolbypassrls:false,
    can_set_ingest:true}];
   if(q.includes('SELECT 1 AS allowed'))
    return db.sessionActive&&db.deviceRegistered&&db.ownerRegistered&&
     params[0]===session&&params[1]===owner&&params[4]===source&&params[7]==='trainer-42'? [{allowed:1}]:[];
   if(q.includes('INSERT INTO allin_private.v2_device_ingest_nonce_candidate')){
    const hash=params[0];
    if(receipts.has(hash))return [];
    receipts.set(hash,{ownerId:params[1],callbackHash:params[4]});
    return [{nonce_hash:hash}];
   }
   if(q.includes('SELECT s.id,s.activity_id,s.provider'))
    return [{id:source,activity_id:activity,provider:'supported_equipment',
     source_kind:'device_session',source_record_id:'trainer-42',
     source_revision:'1',source_payload_hash:fingerprint,
     training_session_instance_id:null}];
   if(q.includes('SELECT allin_private.v2_activity_append_scalar_candidate')){
    const key=[params[1],params[2],params[4]].join(':');
    const fact=JSON.stringify(params.slice(4));
    if(metrics.has(key)){
     if(metrics.get(key)!==fact)throw Error('Conflicting canonical metric replay');
     return [{result:{replayed:true}}];
    }
    metrics.set(key,fact);db.writes++;return [{result:{replayed:false}}];
   }
   if(/^(SET LOCAL ROLE|RESET ROLE)/.test(q)||
     q.includes('set_config')||q.includes('pg_advisory_xact_lock'))return [];
   throw Error('Unknown query: '+q.slice(0,65));
  }};
  try{const result=await cb(tx);db.receipt=receipts;db.metric=metrics;
   db.commits++;return result;}catch(err){db.rollbacks++;throw err;}
 }};
 const auth={getUser:async token=>token===bearer?{id:owner}:null};
 const adapter=createCertifiedDevicePostgresAdapter({db:sql,auth,
  readVerifiedTokenClaims:()=>({sessionId:session,expiresAtMs:now+600000}),
  nowMs:()=>now});
 return {db,adapter};
}
async function upload(adapter,id,at=now){
 const env=await signInternalDeviceEnvelope(payload,at,
  ('signed-nonce-'+id).padEnd(32,'x'),secret);
 return ingestVerifiedDeviceEnvelopeTransactional(env,adapter,bearer,secret,at);
}
test('real PostgreSQL query adapter uses restricted role and canonical writer with verified Auth row',async()=>{
 const {db,adapter}=dbFixture();
 assert.deepEqual(await upload(adapter,'1'),{status:'written',activityId:activity});
 assert.equal(db.metric.size,1);assert.equal(db.receipt.size,1);
 assert.ok(db.queries.some(x=>x.q.includes('auth.sessions sess')));
 assert.ok(db.queries.some(x=>x.q.includes('v2_device_registrations_candidate')));
 assert.ok(db.queries.some(x=>x.q==='SET LOCAL ROLE allin_v2_device_ingest'));
 assert.ok(db.queries.some(x=>x.q.includes('v2_activity_append_scalar_candidate')));
 assert.equal(db.queries.filter(x=>x.q.includes('SELECT 1 AS allowed')).length,2);
 assert.equal(db.commits,1);
});
test('same callback replay rejected, new signed retry is canonical idempotent',async()=>{
 const {db,adapter}=dbFixture();
 await upload(adapter,'same');
 await assert.rejects(upload(adapter,'same'),/nonce|replay/);
 assert.deepEqual(await upload(adapter,'fresh',now+120000),
  {status:'already_applied',activityId:activity});
 assert.equal(db.metric.size,1);assert.equal(db.receipt.size,2);
});
test('missing Auth row or revoked device fails before nonce or metric',async()=>{
 for(const key of ['sessionActive','deviceRegistered','ownerRegistered']){
  const {db,adapter}=dbFixture();db[key]=false;
  await assert.rejects(upload(adapter,key),/denied/);
  assert.equal(db.metric.size,0);assert.equal(db.receipt.size,0);
 }
});
test('privileged DB credential rejected before any owner/source query',async()=>{
 const {db,adapter}=dbFixture();db.superuser=true;
 await assert.rejects(upload(adapter,'bad-role'),/least-privilege/);
 assert.equal(db.metric.size,0);assert.equal(db.receipt.size,0);
});
test('canonical SQL snapshot and nonce rollback together on source mismatch',async()=>{
 const {db,adapter}=dbFixture();
 // Bad source record has same signing key but mismatched persisted identity.
 const forged={...payload,identity:{...payload.identity,sourceRecordId:'forged'}};
 const envelope=await signInternalDeviceEnvelope(forged,now,'forged-nonce-1234567891234567',secret);
 await assert.rejects(ingestVerifiedDeviceEnvelopeTransactional(
  envelope,adapter,bearer,secret,now),/registered device source denied/i);
 assert.equal(db.metric.size,0);assert.equal(db.receipt.size,0);
 assert.equal(db.rollbacks,1);
});
