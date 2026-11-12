'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {planAutomaticQualification,runAutomaticQualification,requestKey,WRITER,ENERGY_WRITER,HOSTED_READINESS_SQL,checkHostedIngestReadiness}=
  require('./run-v2-ingredient-auto-qualification.cjs');
const PROFILE='a4b12c65-9fe7-4a89-8c7b-2357656ac134';
const nutrient=(id,amount,unitName='g')=>({nutrient:{id,unitName},amount});
function fixture() {
  const payload_utf8=JSON.stringify({provider:'usda_fdc',dataType:'Foundation',fdcId:790577,
    basis_quantity:100,basis_unit:'g',
    foodNutrients:[nutrient(2048,44,'kcal'),nutrient(1003,0.94),nutrient(1005,9.93),
      nutrient(1004,0.1)]});
  return {sourceProfileKey:'red_onion_raw',profileId:PROFILE,expectedRevision:1,
    candidates:[{source_profile_key:'red_onion_raw',canonical_name:'Red onion',
      identity_kind:'generic_food',preparation_state:'raw',locale:'en',
      aliases:['Onions, red, raw'],sources:[{
        provider:'usda_fdc',source_data_type:'Foundation',external_record_id:'790577'
      }]}],
    documents:[{source_profile_key:'red_onion_raw',payload_utf8,
      payload_sha256:createHash('sha256').update(payload_utf8).digest('hex')}]};
}
function fakeClient({failAt=0,replay=false,badReceipt=false,rollbackFails=false,commitFails=false,energyFail=false,badEnergyReceipt=false}={}) {
  const calls=[],events=new Set();
  let writerCount=0;
  return {calls,events,async query(sql,args) {
    calls.push({sql,args});
    if(sql==='ROLLBACK'&&rollbackFails)throw Error('rollback lost');
    if(sql==='COMMIT'&&commitFails)throw Error('connection lost at commit');
    if(sql===ENERGY_WRITER) {
      if(energyFail)throw Error('source energy evidence missing');
      return {rows:[{result:badEnergyReceipt?
        {status:'attested',attestation_id:0,calculation_ready:true}:
        {status:'attested',attestation_id:31,calculation_ready:false}}]};
    }
    if(sql===WRITER) {
      writerCount+=1;
      if(failAt===writerCount)throw Error('writer transaction rejected');
      const key=args[5];
      const replayed=replay||events.has(key);
      if(!replayed)events.add(key);
      return {rows:[{result:{status:replayed?'replayed':'reviewed',
        profile_id:badReceipt?'00000000-0000-4000-8000-000000000000':args[0],
        review_status:args[3],profile_revision:args[1]+1,event_id:writerCount}}]};
    }
    return {rows:[]};
  }};
}
test('automatic qualification reuses canonical writer twice inside one transaction',async()=>{
 const data=fixture(),client=fakeClient();
 const result=await runAutomaticQualification({client,...data});
 assert.deepEqual(client.calls.map(x=>x.sql),['BEGIN',WRITER,WRITER,'COMMIT']);
 assert.deepEqual(client.calls.filter(x=>x.sql===WRITER).map(x=>x.args[3]),
   ['needs_review','reviewed']);
 assert.equal(result.status,'source_qualified_not_published');
 assert.equal(result.calculationReady,false);
 assert.equal(result.publicationApproved,false);
 assert.equal(client.events.size,2);
});
test('failure of second canonical write rolls back entire transaction',async()=>{
 const client=fakeClient({failAt:2});
 await assert.rejects(runAutomaticQualification({client,...fixture()}),/writer transaction rejected/);
 assert.deepEqual(client.calls.map(x=>x.sql),['BEGIN',WRITER,WRITER,'ROLLBACK']);
 assert.equal(client.calls.some(x=>x.sql==='COMMIT'),false);
});
test('canonical receipt mismatch forces rollback',async()=>{
 const client=fakeClient({badReceipt:true});
 await assert.rejects(runAutomaticQualification({client,...fixture()}),/inconsistent/);
 assert.deepEqual(client.calls.map(x=>x.sql),['BEGIN',WRITER,'ROLLBACK']);
});
test('unknown rollback outcome is reported and connection must be discarded',async()=>{
 const client=fakeClient({failAt:1,rollbackFails:true});
 await assert.rejects(runAutomaticQualification({client,...fixture()}),/rollback outcome unknown/);
});
test('idempotent replay keys are stable and stage-scoped',async()=>{
 const data=fixture(),first=planAutomaticQualification(data),again=planAutomaticQualification(data);
 assert.deepEqual(first.phases.map(x=>x.idempotencyKey),again.phases.map(x=>x.idempotencyKey));
 assert.notEqual(first.phases[0].idempotencyKey,first.phases[1].idempotencyKey);
 assert.notEqual(requestKey(PROFILE,1,'a'.repeat(64),'reviewed'),
   requestKey(PROFILE,1,'b'.repeat(64),'reviewed'));
 const client=fakeClient({replay:true});
 const result=await runAutomaticQualification({client,...data});
 assert(result.events.every(x=>x.status==='replayed'));
 assert.equal(client.calls.at(-1).sql,'COMMIT');
});
test('invalid source digest and alias conflicts never begin a transaction',async()=>{
 const data=fixture(),client=fakeClient();
 data.documents[0].payload_sha256='0'.repeat(64);
 await assert.rejects(runAutomaticQualification({client,...data}),/preflight blocked/);
 assert.equal(client.calls.length,0);
 const other=fixture();
 other.candidates.push({...other.candidates[0],source_profile_key:'second'});
 other.documents.push({...other.documents[0],source_profile_key:'second'});
 await assert.rejects(runAutomaticQualification({client,...other}),/preflight blocked/);
 assert.equal(client.calls.length,0);
});
test('no client, invalid profile or stale revision fails before database access',async()=>{
 const data=fixture(),client=fakeClient();
 await assert.rejects(runAutomaticQualification({...data}),/Trusted database session/);
 await assert.rejects(runAutomaticQualification({client,...data,profileId:'not-a-uuid'}),/canonical profile ID/);
 await assert.rejects(runAutomaticQualification({client,...data,expectedRevision:0}),/positive revision/);
 assert.equal(client.calls.length,0);
});

test('ambiguous commit acknowledgement is never mislabeled rolled back',async()=>{
 const client=fakeClient({commitFails:true});
 await assert.rejects(runAutomaticQualification({client,...fixture()}),/COMMIT outcome unknown/);
 assert.deepEqual(client.calls.map(x=>x.sql),['BEGIN',WRITER,WRITER,'COMMIT']);
});

test('optional energy attestation uses canonical evidence function inside same transaction',async()=>{
 const client=fakeClient();
 const result=await runAutomaticQualification({client,...fixture(),attestEnergy:true});
 assert.deepEqual(client.calls.map(c=>c.sql),
   ['BEGIN',WRITER,WRITER,ENERGY_WRITER,'COMMIT']);
 assert.equal(client.calls[3].args[1],3);
 assert.equal(result.energyAttestation.attestation_id,31);
 assert.equal(result.calculationReady,false);
 assert.equal(result.publicationApproved,false);
});
test('missing or invalid energy evidence rolls back BOTH profile review stages',async()=>{
 for(const props of [{energyFail:true},{badEnergyReceipt:true}]) {
   const client=fakeClient(props);
   await assert.rejects(runAutomaticQualification({client,...fixture(),attestEnergy:true}),
     /source energy evidence missing|invalid receipt/);
   assert.deepEqual(client.calls.map(c=>c.sql),
     ['BEGIN',WRITER,WRITER,ENERGY_WRITER,'ROLLBACK']);
 }
});
test('energy attestation mode rejects caller coercion before transaction',async()=>{
 const client=fakeClient();
 await assert.rejects(runAutomaticQualification({client,...fixture(),attestEnergy:'true'}),
  /explicit boolean/);
 assert.equal(client.calls.length,0);
});

test('hosted preflight rejects uninstalled schema, postgres and unsafe privilege grants',async()=>{
 const valid={
  login:'allin_ing_workload_food_ingest_v1',
  effective_role:'allin_v2_ingredient_reviewer',
  ingredients:true,profiles:true,sources:true,review_events:true,
  energy_attestations:true,review_writer:true,energy_writer:true,
  reviewer_role:true,publisher_role:true,login_least_privileged:true,
  reviewer_member:true,profiles_rls_enabled:true,
  publisher_member:false,login_public_create:false,
  login_direct_profile_write:false,login_private_audit_read:false,
  login_review_execute:true,login_energy_execute:true
 };
 const client=rows=>({query:async sql=>{
  assert.equal(sql,HOSTED_READINESS_SQL);
  return {rows};
 }});
 assert.deepEqual(await checkHostedIngestReadiness(client([valid])),
  {ready:true,login:valid.login,publicationEnabled:false});
 await assert.rejects(checkHostedIngestReadiness(client([valid]),{requirePublisher:true}),
  /Hosted ingest readiness denied/);
 const published={...valid,publisher_member:true};
 assert.deepEqual(await checkHostedIngestReadiness(client([published]),{requirePublisher:true}),
  {ready:true,login:valid.login,publicationEnabled:true});
 for(const change of [
  {ingredients:false},{review_writer:false},{energy_attestations:false},
  {login:'postgres'},{login_least_privileged:false},
  {reviewer_member:false},{profiles_rls_enabled:false},
  {login_public_create:true},{login_direct_profile_write:true},
  {login_private_audit_read:true},{login_review_execute:false},
  {login_energy_execute:false},{effective_role:'postgres'},
  {publisher_member:true}
 ]) {
  await assert.rejects(checkHostedIngestReadiness(client([{...valid,...change}])),
   /Hosted ingest readiness denied/);
 }
 await assert.rejects(checkHostedIngestReadiness(client([])),/readiness unavailable/);
 await assert.rejects(checkHostedIngestReadiness(client([valid,valid])),/readiness unavailable/);
 await assert.rejects(checkHostedIngestReadiness(client([valid]),{requirePublisher:'true'}),
  /explicit boolean/);
});
