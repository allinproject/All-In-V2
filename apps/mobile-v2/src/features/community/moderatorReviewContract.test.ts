import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 certifyCaseEvidence,certifyReviewQueue,certifyReviewResult,
 validateReviewerSession,withFreshReviewer,
 type ReviewQueue,type ReviewEvidence,type ModeratorReviewTransport,
} from './moderatorReviewContract.ts';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const row={reportId:A,status:'reported' as const,version:1,
 reasonCode:'privacy' as const,submittedAt:'2026-11-13T14:01:00Z'};
const queue=(x:Partial<ReviewQueue>={}):ReviewQueue=>({
 permission:'initial_review',cases:[row],complete:true,nextCursor:null,...x,
});
const evidence=(x:Partial<ReviewEvidence>={}):ReviewEvidence=>({
 reportId:A,status:'reported',version:1,reasonCode:'privacy',
 reasonDetail:'Sensitive claim',commentId:C,body:'Reported comment text',
 appealStatement:null,...x,
});
const mock=():ModeratorReviewTransport=>({
 session:async()=>({reviewerId:B,generation:1,permission:'initial_review',authorized:true}),
 queue:async()=>queue(),evidence:async()=>evidence(),
 decide:async()=>({reportId:A,version:2,decision:'hold'}),
 resolveAppeal:async()=>({reportId:A,version:2,appealDecision:'overturn'}),
});
test('initial queue only accepts a minimal, ordered and complete server projection',()=>{
 assert.equal(certifyReviewQueue(queue(),'initial_review').cases.length,1);
 assert.throws(()=>certifyReviewQueue({...queue(),cases:[{...row,reporterId:B}]} as ReviewQueue,
 'initial_review'),/Unexpected private/);
 assert.throws(()=>certifyReviewQueue(queue({complete:false}),'initial_review'),/Invalid or partial/);
 assert.throws(()=>certifyReviewQueue(queue({cases:[row,row]}),'initial_review'),/invalid moderator case/);
 assert.throws(()=>certifyReviewQueue(queue({permission:'appeal_review'}),'initial_review'),/Invalid or partial/);
 assert.throws(()=>certifyReviewQueue(queue({cases:[{...row,submittedAt:'not a date'}]}),
 'initial_review'),/invalid moderator case/);
});
test('50-case backlog requires matching final cursor and cannot hide truncation',()=>{
 const cases=Array.from({length:50},(_,i)=>({
  ...row,reportId:'11111111-1111-4111-8111-'+String(i).padStart(12,'0'),
 }));
 const cursor={submittedAt:row.submittedAt,reportId:cases[49].reportId};
 assert.equal(certifyReviewQueue(queue({cases,complete:false,nextCursor:cursor}),
  'initial_review').complete,false);
 assert.throws(()=>certifyReviewQueue(queue({cases,complete:false,
  nextCursor:{...cursor,reportId:B}}),'initial_review'),/Invalid moderator continuation/);
 assert.throws(()=>certifyReviewQueue(queue({cases:[...cases,row]}),'initial_review'),/Invalid or partial/);
});
test('private evidence is read only after eligibility and cannot include hidden raw columns',()=>{
 assert.equal(certifyCaseEvidence(evidence(),A,'initial_review').body,'Reported comment text');
 assert.throws(()=>certifyCaseEvidence({...evidence(),reporterId:B} as ReviewEvidence,A,
  'initial_review'),/overbroad/);
 assert.throws(()=>certifyCaseEvidence(evidence(),B,'initial_review'),/foreign/);
 assert.throws(()=>certifyCaseEvidence(evidence({appealStatement:'Private appeal'}),A,
  'initial_review'),/unauthorized/);
 assert.equal(certifyCaseEvidence(evidence({
  status:'appealed',appealStatement:'Private appeal'
 }),A,'appeal_review').appealStatement,'Private appeal');
 assert.throws(()=>certifyCaseEvidence(evidence({
  status:'appealed',appealStatement:null
 }),A,'appeal_review'),/unauthorized/);
});
test('reviewer session must match scope and persist across async reads',async()=>{
 assert.equal(validateReviewerSession(await mock().session(),'initial_review').reviewerId,B);
 assert.throws(()=>validateReviewerSession({
  reviewerId:B,generation:1,permission:'appeal_review',authorized:true
 },'initial_review'),/unavailable/);
 const transport=mock();
 let generation=1;
 transport.session=async()=>({reviewerId:B,generation:generation++,
  permission:'initial_review',authorized:true});
 await assert.rejects(withFreshReviewer({permission:'initial_review',transport,
  execute:async()=>queue()}),/session changed/);
 const wrong={...mock(),session:async()=>null};
 await assert.rejects(withFreshReviewer({permission:'initial_review',transport:wrong,
  execute:async()=>queue()}),/unavailable/);
});
test('decision results must be signed off by current server revision',()=>{
 assert.equal(certifyReviewResult({reportId:A,version:2,decision:'hold'},A,1,'hold').version,2);
 assert.throws(()=>certifyReviewResult({reportId:A,version:3,decision:'hold'},
  A,1,'hold'),/not authoritatively/);
 assert.throws(()=>certifyReviewResult({reportId:B,version:2,decision:'hold'},
  A,1,'hold'),/not authoritatively/);
 assert.throws(()=>certifyReviewResult({reportId:A,version:2,decision:'dismiss'},
  A,1,'hold'),/not authoritatively/);
});
test('private moderator screen is not linked into Community, tabs, or public routes',()=>{
 const community=readFileSync('app/community.tsx','utf8');
 const layout=readFileSync('app/_layout.tsx','utf8');
 const screen=readFileSync('src/features/community/PrivateModeratorReviewContent.tsx','utf8');
 const contract=readFileSync('src/features/community/moderatorReviewContract.ts','utf8');
 assert.ok(!community.includes('PrivateModeratorReviewContent'));
 assert.ok(!layout.includes('PrivateModeratorReviewContent'));
 assert.ok(!screen.includes('supabase.rpc('));
 assert.ok(!contract.includes('supabase.rpc('));
 assert.ok(screen.includes("AppState.addEventListener('change'"));
 assert.ok(screen.includes("status!=='active'"));
 assert.ok(screen.includes('withFreshReviewer('));
 assert.ok(screen.includes('certifyCaseEvidence('));
 assert.ok(screen.includes('certifyReviewResult('));
});
