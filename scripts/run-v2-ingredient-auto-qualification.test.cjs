'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {planAutomaticQualification,runAutomaticQualification,runHostedAutomaticQualification,runRoutedHostedAutomaticQualification,requestKey,WRITER,ENERGY_WRITER,HOSTED_READINESS_SQL,checkHostedIngestReadiness}=
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
  effective_direct_profile_write:false,effective_private_audit_read:false,
  effective_review_execute:true,effective_energy_execute:true
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
  {login_private_audit_read:true},{effective_direct_profile_write:true},
  {effective_private_audit_read:true},{effective_review_execute:false},
  {effective_energy_execute:false},{effective_role:'postgres'},
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

test('hosted entrypoint aborts before BEGIN when reviewer connection is untrusted',async()=>{
 const statements=[];
 const client={query:async(sql)=>{
   statements.push(sql);
   if(sql===HOSTED_READINESS_SQL)return {rows:[{
     login:'postgres',effective_role:'postgres',ingredients:false,profiles:false,
     sources:false,review_events:false,energy_attestations:false,
     review_writer:false,energy_writer:false,reviewer_role:false,publisher_role:false,
     login_least_privileged:false,reviewer_member:false,publisher_member:false,
     profiles_rls_enabled:false,login_public_create:true,
     login_direct_profile_write:false,login_private_audit_read:false,
     effective_direct_profile_write:false,effective_private_audit_read:false,
     effective_review_execute:false,effective_energy_execute:false
   }]};
   throw Error('must not send write query to untrusted host');
 }};
 await assert.rejects(runHostedAutomaticQualification({client,...fixture(),attestEnergy:true}),
   /Hosted ingest readiness denied/);
 assert.deepEqual(statements,[HOSTED_READINESS_SQL]);
});

test('hosted qualifier requires explicit energy-evidence intent before any host query',async()=>{
 const calls=[];
 const client={async query(sql){calls.push(sql);throw Error('host should not be queried');}};
 for(const attestEnergy of [undefined,null,'false',0,1]){
  await assert.rejects(runHostedAutomaticQualification({client,...fixture(),attestEnergy}),
   /Hosted energy attestation intent must be an explicit boolean/);
 }
 assert.deepEqual(calls,[]);
});

const fs=require('node:fs'),path=require('node:path');
const evidenceRoot=path.join(__dirname,'../docs/evidence');
const evidenceFile=name=>JSON.parse(fs.readFileSync(path.join(evidenceRoot,name),'utf8'));
function batchFixture(){
 const ev=evidenceFile('ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json');
 const bindings=evidenceFile('ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json');
 const aliasPolicy=evidenceFile('ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json');
 const hashes=evidenceFile('ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json');
 const sourceFoods=[],candidates=[],documents=[],canonicalMappings=[];
 for(let i=0;i<ev.records.length;i++){
  const x=ev.records[i],form=aliasPolicy.records.find(a=>a.source_profile_key===x.profile);
  const selected=hashes.records.find(h=>h.fdcId===x.fdcId);
  const foodNutrients=[nutrient(Number(x.energy.code),x.energy.kcal,'kcal'),
   ...(x.energy.alternative?[nutrient(Number(x.energy.alternative.code),x.energy.alternative.kcal,'kcal')]:[]),
   nutrient(1003,x.protein),nutrient(1004,x.fat),nutrient(1005,x.carbs),nutrient(1093,x.sodiumMg,'mg')];
  const row={source_profile_key:x.profile,provider:'usda_fdc',dataType:'Foundation',
   fdcId:x.fdcId,source_description:x.source,archive_sha256:ev.archiveSha256,
   payload_sha256:selected.sourcePayloadSha256,basis_quantity:100,basis_unit:'g',foodNutrients};
  sourceFoods.push(row);
  candidates.push({source_profile_key:x.profile,canonical_name:form.display_name,
   identity_kind:'generic_food',preparation_state:form.preparation_state,locale:'en',
   aliases:form.exact_alias_candidates.map(a=>a.value),
   sources:[{provider:'usda_fdc',source_data_type:'Foundation',external_record_id:String(x.fdcId)}]});
  const payload_utf8=JSON.stringify({provider:row.provider,dataType:row.dataType,fdcId:row.fdcId,
   basis_quantity:row.basis_quantity,basis_unit:row.basis_unit,foodNutrients});
  documents.push({source_profile_key:x.profile,payload_utf8,
   payload_sha256:createHash('sha256').update(payload_utf8).digest('hex')});
  canonicalMappings.push({source_profile_key:x.profile,profileId:
   '12345678-1234-4234-8234-'+String(i+1).padStart(12,'0'),
   expectedRevision:1,sourceFdcId:String(x.fdcId),sourcePayloadSha256:row.payload_sha256});
 }
 return {sourceFoods,sourceBindings:bindings,sourceEvidence:ev,aliasPolicy,
  candidates,documents,canonicalMappings,attestEnergy:false};
}
function routedClient({failSecond=false}={}){
 const calls=[],proof={login:'allin_ing_workload_food_ingest_v1',
  effective_role:'allin_v2_ingredient_reviewer',
  ingredients:true,profiles:true,sources:true,review_events:true,
  energy_attestations:true,review_writer:true,energy_writer:true,
  reviewer_role:true,publisher_role:true,login_least_privileged:true,
  reviewer_member:true,profiles_rls_enabled:true,
  publisher_member:false,login_public_create:false,
  login_direct_profile_write:false,login_private_audit_read:false,
  effective_direct_profile_write:false,effective_private_audit_read:false,
  effective_review_execute:true,effective_energy_execute:true};
 let writes=0;
 return {calls,async query(sql,args){
  calls.push({sql,args});
  if(sql===HOSTED_READINESS_SQL)return {rows:[proof]};
  if(sql===WRITER){
   writes++;
   if(failSecond && writes===2)throw Error('canonical writer denied');
   return {rows:[{result:{status:'reviewed',profile_id:args[0],
     review_status:args[3],profile_revision:args[1]+1,event_id:writes}}]};
  }
  if(sql===ENERGY_WRITER)return {rows:[{result:{status:'attested',attestation_id:99,
   calculation_ready:false}}]};
  return {rows:[]};
 }};
}
test('eight verified USDA routing entries reach only canonical SQL writer through restricted session',async()=>{
 const client=routedClient(),result=await runRoutedHostedAutomaticQualification({client,...batchFixture()});
 assert.equal(result.qualified.length,8);
 assert.equal(result.exceptions.length,0);
 assert.equal(result.status,'source_qualified_not_published');
 assert.equal(result.calculationReady,false);
 assert.equal(result.publicationApproved,false);
 assert.equal(client.calls.filter(c=>c.sql===HOSTED_READINESS_SQL).length,1);
 assert.equal(client.calls.filter(c=>c.sql===WRITER).length,16);
 assert.equal(client.calls.filter(c=>c.sql==='BEGIN').length,8);
 assert.equal(client.calls.filter(c=>c.sql==='COMMIT').length,8);
 assert.equal(client.calls.filter(c=>c.sql===ENERGY_WRITER).length,0);
 const batch=batchFixture();
 for(const [index,row] of batch.sourceFoods.entries()){
  const calls=client.calls.filter(c=>c.sql===WRITER).slice(index*2,index*2+2);
  assert(calls.every(c=>c.args[2]===row.payload_sha256));
 }
});
test('one wrong USDA source digest is an exception while seven verified sources use canonical writer',async()=>{
 const batch=batchFixture();
 batch.sourceFoods[1].payload_sha256='f'.repeat(64);
 const client=routedClient();
 const result=await runRoutedHostedAutomaticQualification({client,...batch});
 assert.equal(result.qualified.length,7);
 assert.equal(result.exceptions.length,1);
 assert.equal(result.exceptions[0].source_profile_key,'red_onion_raw');
 assert.equal(client.calls.filter(c=>c.sql===WRITER).length,14);
});
test('stale canonical mapping and missing identity never call the writer',async()=>{
 const batch=batchFixture();
 batch.canonicalMappings[0].sourcePayloadSha256='f'.repeat(64);
 for(const i of [1,2,3,4,5,6,7])batch.canonicalMappings[i].profileId='not-a-uuid';
 const client=routedClient();
 const result=await runRoutedHostedAutomaticQualification({client,...batch});
 assert.equal(result.qualified.length,0);
 assert.equal(result.exceptions.length,8);
 assert.equal(client.calls.length,0);
});
test('global USDA source drift blocks all writes, including otherwise valid rows',async()=>{
 const batch=batchFixture(),client=routedClient();
 batch.sourceFoods[0].archive_sha256='0'.repeat(64);
 const result=await runRoutedHostedAutomaticQualification({client,...batch});
 assert.equal(result.qualified.length,7);
 assert.equal(result.exceptions.length,1);
 assert.equal(client.calls.filter(c=>c.sql===WRITER).length,14);
 const global=batchFixture(),client2=routedClient();
 global.sourceEvidence.archiveSha256='f'.repeat(64);
 const denied=await runRoutedHostedAutomaticQualification({client:client2,...global});
 assert.equal(denied.qualified.length,0);
 assert.equal(client2.calls.length,0);
});
test('canonical SQL failure rolls back and never claims success',async()=>{
 const client=routedClient({failSecond:true});
 await assert.rejects(runRoutedHostedAutomaticQualification({client,...batchFixture()}),
  /canonical writer denied/);
 assert.equal(client.calls.filter(c=>c.sql==='ROLLBACK').length,1);
 assert.equal(client.calls.filter(c=>c.sql==='COMMIT').length,0);
});
test('routed writer rejects implied energy-attestation intent before any connection',async()=>{
 const batch=batchFixture(),client=routedClient();
 delete batch.attestEnergy;
 await assert.rejects(runRoutedHostedAutomaticQualification({client,...batch}),
  /explicit boolean/);
 assert.equal(client.calls.length,0);
});
