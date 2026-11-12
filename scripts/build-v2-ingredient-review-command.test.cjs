'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildReviewCommand,stableCanonical,createSupabaseReviewerDependencies}=require('./build-v2-ingredient-review-command.cjs');
const uid='11111111-1111-4111-8111-111111111111';
const approver='22222222-2222-4222-8222-222222222222';
const profile='33333333-3333-4333-8333-333333333333';
const source='44444444-4444-4444-8444-444444444444';
const action='55555555-5555-4555-8555-555555555555';
const request={
 bearerToken:'verified-session-test-token-do-not-use',
 action:'review',actionId:action,profileId:profile,
 sourceRecordId:source,sourceProfileKey:'black_beans_canned_drained',
 expectedRevision:2
};
const sourceContext={
 ownerReviewStatus:'review_stage_complete',authorizedToWrite:false,
 calculationReady:false,publicationApproved:false,
 profileReviewStatus:'needs_review',profileId:profile,
 sourceRecordId:source,sourceProfileKey:request.sourceProfileKey,
 sourcePayloadSha256:'a'.repeat(64),energyPolicyVersion:'usda-fdc-energy-specific-legacy-v1',
 nutrientSetVersion:'cookbook-launch-macros-v1',energyMethod:'atwater_specific',
 sourceFacts:{energy_kcal:115,protein_g:6.91,carbohydrate_g:19.8,total_fat_g:1.27,sodium_mg:218},
 sourceArchiveSha256:'b'.repeat(64),formScopeId:'cooked_drained'
};
const deps=()=>({
 verifyAccessToken:async _token=>({id:uid}),
 findReviewerAuthorization:async _id=>({
 user_id:uid,enabled:true,capability:'reviewer',expires_at:'2099-11-12T00:00:00Z',approved_by:approver
 }),
 loadAuthoritativeReview:async()=>sourceContext
});
const run=(requestOverrides={},depOverrides={})=>
 buildReviewCommand({...request,...requestOverrides},{...deps(),...depOverrides});
test('verified reviewer receives only a prepared, non-publish command',async()=>{
 const r=await run();
 assert.equal(r.status,'prepared_review_command_only');
 assert.equal(r.writerCommand.p_actor_id,uid);
 assert.equal(r.writerCommand.p_action,'review');
 assert.equal(r.writerCommand.p_profile_id,profile);
 assert.match(r.writerCommand.p_evidence_sha256,/^[a-f0-9]{64}$/);
 assert.equal(r.releaseAuthorized,false);
 assert.equal(r.calculationReady,false);
});
test('denies missing/invalid bearer and spoofed action or revision',async()=>{
 for(const v of ['',null,123]){
   assert.equal((await run({bearerToken:v})).status,'denied');
 }
 assert.equal((await run({action:'publish'})).status,'denied');
 assert.equal((await run({expectedRevision:0})).status,'denied');
 assert.equal((await run({actionId:'wrong'})).status,'denied');
});
test('server Auth verification is mandatory: no trusting user-provided IDs',async()=>{
 assert.equal((await run({actorId:approver},{
 verifyAccessToken:async()=>null
 })).status,'denied');
 assert.equal((await run({},{
 verifyAccessToken:async()=>{throw Error('revoked session')}
 })).status,'denied');
 assert.equal((await run({},{
 verifyAccessToken:async()=>({id:'not-uuid'})
 })).status,'denied');
});
test('active independent reviewer approval required, revoked/expired/inconsistent actor denied',async()=>{
 const original=await deps().findReviewerAuthorization(uid);
 for(const changed of [
   {enabled:false},{expires_at:'2000-01-01T00:00:00Z'},
   {approved_by:uid},{capability:'athlete'}, {user_id:approver}
 ]){
   const result=await run({},{
     findReviewerAuthorization:async()=>({...original,...changed})
   });
   assert.equal(result.status,'denied',JSON.stringify(changed));
 }
});
test('source review is trusted server data and cannot self-promote publication',async()=>{
 for(const changed of [
   {ownerReviewStatus:'review_required'},{authorizedToWrite:true},
   {calculationReady:true},{profileReviewStatus:'calculation_ready'},
   {profileId:approver},{sourcePayloadSha256:'not-a-sha'},
   {energyPolicyVersion:'unknown'}, {sourceFacts:{protein_g:0}},
   {energyMethod:'atwater_general'}
 ]){
   const r=await run({},{
     loadAuthoritativeReview:async()=>({...sourceContext,...changed})
   });
   assert.equal(r.status,'denied',JSON.stringify(changed));
 }
});
test('deterministic hash does not depend on equivalent source-fact object ordering',async()=>{
 const reversed=Object.fromEntries(Object.entries(sourceContext.sourceFacts).reverse());
 const a=await run();
 const b=await run({},{
   loadAuthoritativeReview:async()=>({...sourceContext,sourceFacts:reversed})
 });
 assert.equal(a.writerCommand.p_evidence_sha256,b.writerCommand.p_evidence_sha256);
 assert.equal(stableCanonical({b:2,a:1}),stableCanonical({a:1,b:2}));
});

test('Supabase Auth getUser validates supplied bearer and private registry controls reviewer enrollment',async()=>{
 const calls=[];
 const authClient={auth:{getUser:async token=>{calls.push(['getUser',token]);return {data:{user:{id:uid}},error:null}}}};
 const reviewerRegistry={findByUserId:async id=>{calls.push(['privateRegistry',id]);return deps().findReviewerAuthorization(id)}};
 const authoritativeSourceReader={load:async (key,id)=>{calls.push(['source',key,id]);return sourceContext}};
 const adapter=createSupabaseReviewerDependencies({authClient,reviewerRegistry,authoritativeSourceReader});
 const r=await buildReviewCommand(request,adapter);
 assert.equal(r.status,'prepared_review_command_only');
 assert.deepEqual(calls[0],['getUser',request.bearerToken]);
 assert.deepEqual(calls[1],['privateRegistry',uid]);
 assert.deepEqual(calls[2],['source',request.sourceProfileKey,request.sourceRecordId]);
});
test('a failed Supabase Auth getUser response never reaches private reviewer lookup',async()=>{
 let touched=false;
 const adapter=createSupabaseReviewerDependencies({
  authClient:{auth:{getUser:async()=>({data:{user:{id:uid}},error:{message:'revoked'}})}},
  reviewerRegistry:{findByUserId:async()=>{touched=true;return null}},
  authoritativeSourceReader:{load:async()=>sourceContext}
 });
 const r=await buildReviewCommand(request,adapter);
 assert.equal(r.status,'denied');
 assert.equal(touched,false);
 assert.equal(r.writerCommand,null);
});
