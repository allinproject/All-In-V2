import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptCompletionReceipt,compareCompletionHandoffReplay,completionNavigationTarget,
 type CompletionHandoff,type CompletionReceipt} from './completedActivityHandoffContract.ts';
const handoff=():CompletionHandoff=>({
 eventId:'event-1',ownerId:'athlete-1',sessionInstanceId:'session-1',
 sourceKind:'watch',sourceRecordId:'watch-source-1',
 sport:'running',sportSubtype:'trail',athleteLocalDate:'2026-11-11',
 timezone:'America/Chicago',finishedAt:'2026-11-11T06:15:00-06:00',
 planRevisionSessionId:'revision-session-1',finishEventId:'finish-1',
});
const receipt=(status:CompletionReceipt['status'],id:string|null):CompletionReceipt=>({
 eventId:'event-1',ownerId:'athlete-1',sessionInstanceId:'session-1',
 sourceRecordId:'watch-source-1',status,completedActivityId:id,
});
test('exact handoff retry is acceptable but changed event payload fails closed',()=>{
 const h=handoff();
 assert.equal(compareCompletionHandoffReplay(h,{...h}),'exact_retry');
 for(const edit of [{sportSubtype:'road'},{sourceRecordId:'different'},
  {ownerId:'other'},{planRevisionSessionId:null},{sessionInstanceId:'other'},
  {finishedAt:'2026-11-11T06:45:00-06:00'}]){
  assert.throws(()=>compareCompletionHandoffReplay(h,{...h,...edit}),/mismatch|payload changed/);
 }
});
test('only authoritative ready receipt may open a real completed activity',()=>{
 const h=handoff();
 const ready=acceptCompletionReceipt(h,receipt('ready','completed-1'));
 assert.equal(completionNavigationTarget(ready),'completed-1');
 const pending=acceptCompletionReceipt(h,receipt('pending',null));
 assert.equal(completionNavigationTarget(pending),null);
 const review=acceptCompletionReceipt(h,receipt('needs_review',null));
 assert.equal(completionNavigationTarget(review),null);
});
test('pending/review cannot claim a canonical activity and ready requires ID',()=>{
 const h=handoff();
 assert.throws(()=>acceptCompletionReceipt(h,receipt('ready',null)),/requires canonical/);
 assert.throws(()=>acceptCompletionReceipt(h,receipt('pending','completed-1')),/cannot claim/);
 assert.throws(()=>acceptCompletionReceipt(h,receipt('needs_review','completed-1')),/cannot claim/);
});
test('receipt from wrong source or account never completes the workout',()=>{
 const h=handoff();
 for(const edit of [{ownerId:'athlete-2'},{sourceRecordId:'watch-source-2'},
 {sessionInstanceId:'session-2'},{eventId:'other-event'}]){
  assert.throws(()=>acceptCompletionReceipt(h,{...receipt('ready','completed-1'),...edit}),/does not match/);
 }
});
test('timezone/local date and source semantics remain in the exact immutable handoff',()=>{
 const h=handoff();
 assert.equal(h.athleteLocalDate,'2026-11-11');
 assert.equal(h.timezone,'America/Chicago');
 assert.equal(h.sportSubtype,'trail');
 assert.throws(()=>compareCompletionHandoffReplay({...h,athleteLocalDate:'invalid'},h),/Invalid canonical/);
 assert.throws(()=>compareCompletionHandoffReplay({...h,finishedAt:'2026-11-11 06:15'},h),/Invalid canonical/);
});
