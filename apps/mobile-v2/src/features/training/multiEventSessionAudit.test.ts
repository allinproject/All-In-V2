import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCertifiedSeasonSessions,type OwnerDatedSession} from './multiEventSessionAudit.ts';

const owner='athlete-a',revision='accepted-7',start='2027-03-25',first='2027-04-10',last='2027-06-05';
const events=[
 {id:'half',date:first,name:'Half',sport:'running',priority:'B' as const,demand:'endurance' as const},
 {id:'goal',date:last,name:'Goal',sport:'running',priority:'A' as const,demand:'endurance' as const}
];
const days:string[]=[];
for(let n=Date.parse(start+'T12:00:00Z');n<=Date.parse(last+'T12:00:00Z');n+=86400000)
 days.push(new Date(n).toISOString().slice(0,10));
const demand={aerobic:'moderate' as const,mechanicalImpact:'moderate' as const,
 localMuscular:'moderate' as const,technicalSkill:'not_applicable' as const};
function session(id:string,date:string,priority:'competition'|'key'|'supporting',intensity:'easy'|'moderate'|'hard'|'unknown'):OwnerDatedSession{
 return {id,ownerId:owner,planRevisionId:revision,date,status:'planned',intent:{
  id,sport:'running',label:id,purpose:'Approved plan',priority,intensity,durationMinutes:45,
  demand,stressTags:[],evidenceRefs:['accepted-plan']
 }};
}
function setup(){
 const common={ownerId:owner,authSessionGeneration:5,fromDate:start,
  throughDate:last,snapshotVersion:'snapshot-7',complete:true,nextCursor:null as string|null};
 const ownerSeason={
  expectedOwnerId:owner,authenticatedOwnerId:owner,activeSessionGeneration:5,
  accessGateReady:true,activePlanRevisionId:revision,startDate:start,events,
  plannedSnapshot:{...common,records:events.map((e,i)=>({
   id:'race-'+i,ownerId:owner,planRevisionId:revision,athleteLocalDate:e.date,
   sport:'running' as const,state:'planned' as const
  }))},
  daySnapshot:{...common,records:days.map((date,i)=>({
   id:'d-'+i,ownerId:owner,planRevisionId:revision,athleteLocalDate:date,
   dayState:date===first||date===last?'race' as const:'rest' as const
  }))},
  competitionSnapshot:{...common,records:events.map((e,i)=>({
   eventId:e.id,sessionId:'race-'+i,planRevisionId:revision,ownerId:owner,
   athleteLocalDate:e.date,sport:e.sport,competitionConfirmed:true as const
  }))}
 };
 const phaseDecisions=[
  {eventId:'half',effort:'supported' as const,taperDays:2,recoveryReviewDays:14,
   source:'athlete_confirmed' as const,evidenceRefs:[]},
  {eventId:'goal',effort:'peak' as const,taperDays:14,recoveryReviewDays:21,
   source:'coach_evidence_reviewed' as const,evidenceRefs:['accepted-history']}
 ];
 const sessions=[
  session('race-0',first,'competition','hard'),
  session('race-1',last,'competition','hard'),
  session('recovery-hard','2027-04-13','key','hard'),
  session('taper-hard','2027-05-29','key','hard'),
  session('unknown','2027-04-11','supporting','unknown'),
  session('race-extra',last,'supporting','easy')
 ];
 return{phase:{ownerSeason,expectedPlanRevisionId:revision,phaseDecisions},
  acceptedSessionSnapshot:{...common,records:sessions}};
}
test('certified accepted sessions flag hard recovery, taper and additional race-day workout',()=>{
 const f=setup(),snapshot=f.acceptedSessionSnapshot.records.map(x=>({...x}));
 const x=auditCertifiedSeasonSessions(f);
 assert.equal(x.status,'blocked');
 if(x.status==='unavailable')throw Error(x.reason);
 assert.ok(x.issues.some(i=>i.code==='KEY_WORK_DURING_RECOVERY'&&i.sessionIds.includes('recovery-hard')));
 assert.ok(x.issues.some(i=>i.code==='HARD_WORK_DURING_TAPER'&&i.sessionIds.includes('taper-hard')));
 assert.ok(x.issues.some(i=>i.code==='SESSION_ON_EVENT_DAY'&&i.sessionIds.includes('race-extra')));
 assert.ok(x.issues.some(i=>i.code==='UNKNOWN_INTENSITY_IN_WINDOW'&&i.sessionIds.includes('unknown')));
 assert.equal(x.sessionCount,6);
 assert.equal(x.noAutomaticSessionMoves,true);
 assert.deepEqual(f.acceptedSessionSnapshot.records.map(s=>s.date),snapshot.map(s=>s.date));
});
test('competition sessions themselves are exempt from extraneous workout warning',()=>{
 const f=setup();
 f.acceptedSessionSnapshot.records=f.acceptedSessionSnapshot.records.filter(r=>r.id==='race-0'||r.id==='race-1');
 const x=auditCertifiedSeasonSessions(f);
 assert.equal(x.status,'review_required');
 if(x.status==='unavailable')throw Error(x.reason);
 assert.equal(x.issues.filter(i=>i.code==='SESSION_ON_EVENT_DAY').length,0);
});
test('wrong owner, stale revision, mixed snapshot or partial page cannot be audited',()=>{
 const changed=setup();changed.acceptedSessionSnapshot.ownerId='other';
 assert.equal(auditCertifiedSeasonSessions(changed).status,'unavailable');
 const stale=setup();stale.acceptedSessionSnapshot.records[0]={...stale.acceptedSessionSnapshot.records[0],planRevisionId:'old'};
 assert.equal(auditCertifiedSeasonSessions(stale).status,'unavailable');
 const mixed=setup();mixed.acceptedSessionSnapshot.snapshotVersion='other';
 assert.equal(auditCertifiedSeasonSessions(mixed).status,'unavailable');
 const paged=setup();paged.acceptedSessionSnapshot.nextCursor='more';
 assert.equal(auditCertifiedSeasonSessions(paged).status,'unavailable');
});
test('foreign session rows or duplicate session IDs cannot silently become accepted evidence',()=>{
 const foreign=setup();foreign.acceptedSessionSnapshot.records[1]={...foreign.acceptedSessionSnapshot.records[1],ownerId:'other'};
 assert.equal(auditCertifiedSeasonSessions(foreign).status,'unavailable');
 const dup=setup();dup.acceptedSessionSnapshot.records[1]={...dup.acceptedSessionSnapshot.records[1],id:'race-0'};
 assert.equal(auditCertifiedSeasonSessions(dup).status,'blocked');
});

test('strength-related muscular fatigue and running impact are distinct component checks',()=>{
 const f=setup();
 f.acceptedSessionSnapshot.records.push({
  ...session('lift-fatigue','2027-04-12','supporting','moderate'),
  intent:{...session('lift-fatigue','2027-04-12','supporting','moderate').intent,
   sport:'strength' as const,demand:{
    aerobic:'low' as const,mechanicalImpact:'low' as const,
    localMuscular:'high' as const,technicalSkill:'not_applicable' as const
   }}
 });
 f.acceptedSessionSnapshot.records.push({
  ...session('impact','2027-05-30','supporting','moderate'),
  intent:{...session('impact','2027-05-30','supporting','moderate').intent,
   demand:{aerobic:'moderate' as const,mechanicalImpact:'high' as const,
    localMuscular:'low' as const,technicalSkill:'not_applicable' as const}}
 });
 const r=auditCertifiedSeasonSessions(f);
 assert.notEqual(r.status,'unavailable');
 if(r.status==='unavailable')throw Error(r.reason);
 assert.ok(r.issues.some(i=>i.code==='HIGH_LOCAL_LOAD_DURING_RECOVERY'&&i.sessionIds.includes('lift-fatigue')));
 assert.ok(r.issues.some(i=>i.code==='HIGH_IMPACT_DURING_TAPER'&&i.sessionIds.includes('impact')));
 assert.ok(!r.issues.some(i=>i.code==='HIGH_IMPACT_DURING_TAPER'&&i.sessionIds.includes('lift-fatigue')));
});
