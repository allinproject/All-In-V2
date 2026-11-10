import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveSessionLaunch,type LaunchContext} from './sessionLaunchDecision.ts';
const base:LaunchContext={expectedOwnerId:'athlete-a',authenticatedOwnerId:'athlete-a',accessGateReady:true,activeExecution:null,workout:{revisionSessionId:'revision-session-1',ownerId:'athlete-a',planRevisionId:'revision-3',currentPlanRevisionId:'revision-3',slotId:'stable-slot-9',status:'planned',revisionAccepted:true}};
test('start binds the exact accepted revision and logical slot',()=>{
 assert.deepEqual(resolveSessionLaunch(base),{kind:'start',revisionSessionId:'revision-session-1',planRevisionId:'revision-3',slotId:'stable-slot-9'});
});
test('one canonical execution wins over starting a second workout',()=>{
 for(const status of ['active','paused','finishing'] as const){
  assert.deepEqual(resolveSessionLaunch({...base,activeExecution:{id:'existing-1',ownerId:'athlete-a',status,revisionSessionId:'different-session'}}),{kind:'resume',instanceId:'existing-1',reason:'existing_active_execution'});
 }
});
test('unverified active session read must not be interpreted as no active workout',()=>{
 assert.deepEqual(resolveSessionLaunch({...base,activeExecution:undefined}),{kind:'blocked',reason:'active_session_unverified'});
});
test('sign-out, account switch and access gate all block starts',()=>{
 assert.equal(resolveSessionLaunch({...base,authenticatedOwnerId:null}).kind,'blocked');
 assert.equal(resolveSessionLaunch({...base,authenticatedOwnerId:'athlete-b'}).kind,'blocked');
 assert.equal(resolveSessionLaunch({...base,accessGateReady:false}).kind,'blocked');
 assert.equal(resolveSessionLaunch({...base,activeExecution:{id:'x',ownerId:'athlete-b',status:'active',revisionSessionId:null}}).kind,'blocked');
});
test('completed, canceled, skipped, unaccepted and stale plans cannot restart',()=>{
 for(const status of ['completed','cancelled','skipped'] as const){
  assert.equal(resolveSessionLaunch({...base,workout:{...base.workout!,status}}).kind,'blocked');
 }
 assert.deepEqual(resolveSessionLaunch({...base,workout:{...base.workout!,revisionAccepted:false}}),{kind:'blocked',reason:'workout_not_startable'});
 assert.deepEqual(resolveSessionLaunch({...base,workout:{...base.workout!,currentPlanRevisionId:'revision-4'}}),{kind:'blocked',reason:'stale_plan_revision'});
});
test('missing and cross-owner plans cannot start',()=>{
 assert.equal(resolveSessionLaunch({...base,workout:null}).kind,'blocked');
 assert.equal(resolveSessionLaunch({...base,workout:{...base.workout!,ownerId:'athlete-b'}}).kind,'blocked');
});
