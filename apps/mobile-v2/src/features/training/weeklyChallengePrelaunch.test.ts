import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWeeklyChallengePrelaunch,isSameCanonicalChallengeAttempt,
 type WeeklyChallengePreview} from './weeklyChallengePrelaunch.ts';
const sample=():WeeklyChallengePreview=>({
 challengeId:'week-2026-11-09',rulesVersion:'v1',ownerId:'rider-A',state:'open',
 startsAt:'2026-11-09T09:00:00Z',endsAt:'2026-11-16T09:00:00Z',
 commonStructureId:'shared-profile-v1',personalizedPrescriptionId:'prescription-A',
 ownerReadComplete:true,powerEvidence:'verified_supported_source',sourceOwnerId:'rider-A',
 sourceSessionId:'session-A',canonicalSessionId:'session-A',
});
const now='2026-11-11T17:00:00Z';
test('owner-certified active challenge with matching verified power source can be previewed',()=>{
 assert.deepEqual(assessWeeklyChallengePrelaunch(sample(),'rider-A',now),{
  canPreview:true,canStartTraining:true,canEnterVerifiedCompetition:true,reason:'ready',
 });
});
test('foreign owner or partial snapshot fails closed',()=>{
 for(const value of [{ownerId:'rider-B'},{ownerReadComplete:false},{challengeId:''}]){
  assert.equal(assessWeeklyChallengePrelaunch({...sample(),...value},'rider-A',now).canPreview,false);
 }
});
test('closed, future or wrong calendar window never starts a competition',()=>{
 for(const value of [{state:'finalized' as const},{state:'upcoming' as const}]){
  assert.equal(assessWeeklyChallengePrelaunch({...sample(),...value},'rider-A',now).canStartTraining,false);
 }
 assert.equal(assessWeeklyChallengePrelaunch(sample(),'rider-A','2026-11-16T09:00:00Z').reason,'not_open');
 assert.equal(assessWeeklyChallengePrelaunch(sample(),'rider-A','2026-11-09T08:59:59Z').reason,'not_open');
});
test('manual, estimated, pending or unsupported power can train but not rank',()=>{
 for(const powerEvidence of ['manual_or_estimated','pending_verification','unsupported_source'] as const){
  const d=assessWeeklyChallengePrelaunch({...sample(),powerEvidence},'rider-A',now);
  assert.deepEqual(d,{canPreview:true,canStartTraining:true,canEnterVerifiedCompetition:false,reason:'unverified_power'});
 }
});
test('foreign or mismatched certified source cannot imply verified eligibility',()=>{
 for(const value of [{sourceOwnerId:'rider-B'},{sourceSessionId:'another-session'},{canonicalSessionId:null}]){
  const d=assessWeeklyChallengePrelaunch({...sample(),...value},'rider-A',now);
  assert.equal(d.canEnterVerifiedCompetition,false);
  assert.equal(d.canStartTraining,true);
 }
});
test('missing individualized prescription blocks start, even with shared structure',()=>{
 assert.equal(assessWeeklyChallengePrelaunch({...sample(),personalizedPrescriptionId:null},'rider-A',now).canStartTraining,false);
});
test('bad temporal authority is unavailable',()=>{
 assert.equal(assessWeeklyChallengePrelaunch({...sample(),startsAt:'2026-11-16T09:00:00Z'},'rider-A',now).reason,'unavailable');
 assert.equal(assessWeeklyChallengePrelaunch(sample(),'rider-A','not-time').reason,'unavailable');
});
test('same canonical session replay is recognizable without merging separate attempts',()=>{
 const a={challengeId:'c',ownerId:'u',canonicalSessionId:'s'};
 assert.equal(isSameCanonicalChallengeAttempt(a,{...a}),true);
 assert.equal(isSameCanonicalChallengeAttempt(a,{...a,canonicalSessionId:'retry'}),false);
 assert.equal(isSameCanonicalChallengeAttempt(a,{...a,ownerId:'other'}),false);
});
