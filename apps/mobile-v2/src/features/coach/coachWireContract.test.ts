import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoachV18Reply, coachReplyIsCurrent } from './coachWireContract.ts';

const request_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa210';
test('parse observed v18 answer with request identity',()=>{
  assert.deepEqual(parseCoachV18Reply({request_id,message:'  Complete your easy run.  '}),{
    requestId:request_id,message:'Complete your easy run.',proposedAction:null,actionStatus:'proposal_only',
  });
});
test('Coach proposed action is not evidence of an applied write',()=>{
  const proposed_action={action:'change_workout',workout_id:'example'};
  const value=parseCoachV18Reply({request_id,message:'Review this adjustment.',proposed_action});
  assert.deepEqual(value.proposedAction,proposed_action);
  assert.equal(value.actionStatus,'proposal_only');
});
test('reject missing/malformed reply and request identity',()=>{
  assert.throws(()=>parseCoachV18Reply({request_id:'wrong',message:'hello'}),/request identity/);
  assert.throws(()=>parseCoachV18Reply({request_id,message:''}),/message is invalid/);
  assert.throws(()=>parseCoachV18Reply(null),/invalid response/);
});
test('reject bypass and error payloads as successful answers',()=>{
  assert.throws(()=>parseCoachV18Reply({request_id,message:'hello',bypassed:true}),/completed answer/);
  assert.throws(()=>parseCoachV18Reply({error:'offline',retryable:true}),/completed answer/);
});
test('accept only current owner, generation and latest in-flight request',()=>{
  const launched={ownerId:'owner-a',sessionGeneration:4,requestNumber:8};
  assert.equal(coachReplyIsCurrent(launched,launched),true);
  assert.equal(coachReplyIsCurrent(launched,{...launched,ownerId:'owner-b'}),false);
  assert.equal(coachReplyIsCurrent(launched,{...launched,sessionGeneration:5}),false);
  assert.equal(coachReplyIsCurrent(launched,{...launched,requestNumber:9}),false);
});
