import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAndCommitGoalApproval,parseGoalApprovalIntent} from './goalAcceptanceAuthServices.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const outsider='22222222-2222-4222-8222-222222222222';
const session='33333333-3333-4333-8333-333333333333';
const goal='44444444-4444-4444-8444-444444444444';
const revision='55555555-5555-4555-8555-555555555555';
const action='66666666-6666-4666-8666-666666666666';
const review='77777777-7777-4777-8777-777777777777';
const now=Date.parse('2026-11-11T12:00:00Z');
const sha='a'.repeat(64);
function token(user=owner,sid=session){
 const payload=Buffer.from(JSON.stringify({sub:user,session_id:sid})).toString('base64url');
 return 'eyJhbGciOiJIUzI1NiJ9.'+payload+'.signature';
}
function fixture(){
 const calls=[],body={goalId:goal,revisionId:revision,actionId:action,
  reviewId:review,expectedVersion:2,confirmed:true};
 const proof={approved:true,cancelled:false,ownerId:owner,sessionId:session,
  goalId:goal,revisionId:revision,actionId:action,reviewId:review,
  expectedVersion:2,sha256:sha,expiresAt:new Date(now+60_000).toISOString()};
 const authClient={auth:{getUser:async()=>({data:{user:{id:owner}},error:null})}};
 const authorizeReview=async(args)=>{calls.push({kind:'review',args});return proof};
 const commit=async(args)=>{calls.push({kind:'commit',args});return{
  goalId:goal,revisionId:revision,version:3,replayed:false}};
 return {calls,body,proof,authClient,authorizeReview,commit,
  args:{bearerToken:token(),payload:body,armed:true,authClient,
   authorizeReview,commit,now:()=>now}};
}
test('exact reviewed approval uses server fingerprint and verified owner, not client identities',async()=>{
 const f=fixture();const result=await prepareAndCommitGoalApproval(f.args);
 assert.deepEqual(result,{goalId:goal,revisionId:revision,version:3,replayed:false});
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls[0].args,{
  ownerId:owner,sessionId:session,goalId:goal,revisionId:revision,
  actionId:action,reviewId:review,expectedVersion:2});
 assert.deepEqual(f.calls[1].args,{
  p_user_id:owner,p_goal_id:goal,p_candidate_id:revision,
  p_action_id:action,p_expected_version:2,p_payload_sha256:sha});
 assert.ok(!Object.hasOwn(f.calls[1].args,'p_session_id'));
});
test('default off fails before any review or write',async()=>{
 const f=fixture();
 await assert.rejects(prepareAndCommitGoalApproval({...f.args,armed:false}),/not enabled/);
 assert.equal(f.calls.length,0);
});
test('client cannot supply owner, session, digest or an unreviewed non-confirmed intent',()=>{
 const f=fixture();
 for(const mutation of [
  {ownerId:outsider},{sessionId:session},{payloadSha256:sha},{confirmed:false},
  {expectedVersion:1.5},{actionId:'not-uuid'},{confirmed:'true'}]){
  assert.throws(()=>parseGoalApprovalIntent({...f.body,...mutation}));
 }
});
test('invalid, missing or different-session JWT fails closed',async()=>{
 for(const bearerToken of ['garbage',token(owner,'bad'),token(outsider,session)]){
  const f=fixture();
  await assert.rejects(prepareAndCommitGoalApproval({...f.args,bearerToken}));
  assert.equal(f.calls.filter(x=>x.kind==='commit').length,0);
 }
});
test('review status, exact owner/session/version, expiry and fingerprint are required',async()=>{
 const problems=[
  {approved:false},{cancelled:true},{ownerId:outsider},
  {sessionId:outsider},{goalId:outsider},{revisionId:outsider},
  {actionId:outsider},{reviewId:outsider},{expectedVersion:1},
  {sha256:'invalid'},{expiresAt:new Date(now).toISOString()},
  {expiresAt:new Date(now+16*60_000).toISOString()}
 ];
 for(const patch of problems){
  const f=fixture();
  const result=prepareAndCommitGoalApproval({...f.args,
   authorizeReview:async()=>({...f.proof,...patch})});
  await assert.rejects(result,/authenticated review/);
  assert.equal(f.calls.filter(x=>x.kind==='commit').length,0);
 }
});
test('Auth account invalidation while awaiting review prevents commit',async()=>{
 const f=fixture();let calls=0;
 const authClient={auth:{getUser:async()=>{
  calls++;
  return{data:{user:{id:calls===1?owner:outsider}},error:null};
 }}};
 await assert.rejects(prepareAndCommitGoalApproval({...f.args,authClient}),
  /authenticated review/);
 assert.equal(f.calls.filter(x=>x.kind==='commit').length,0);
});
test('untrusted commit receipt cannot declare another revision or version',async()=>{
 for(const patch of [{version:4},{goalId:outsider},{revisionId:outsider},{replayed:'yes'}]){
  const f=fixture();
  await assert.rejects(prepareAndCommitGoalApproval({...f.args,commit:async()=>({
   goalId:goal,revisionId:revision,version:3,replayed:false,...patch
  })}),/authenticated review/);
 }
});
test('exact accepted retry may report replay without creating new action',async()=>{
 const f=fixture();
 const receipt=await prepareAndCommitGoalApproval({...f.args,commit:async()=>({
  goalId:goal,revisionId:revision,version:3,replayed:true
 })});
 assert.equal(receipt.replayed,true);
});
