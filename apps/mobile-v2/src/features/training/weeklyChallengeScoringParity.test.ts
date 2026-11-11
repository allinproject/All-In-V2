import test from 'node:test';
import assert from 'node:assert/strict';
import {previewV1ScoreForParity,compareV1VerifiedAttemptsForParity,
 WEEKLY_INDOOR_SCORING_VERSION,type VerifiedAttemptRankFixture} from './weeklyChallengeScoringParity.ts';
test('V1 challenge-score-v1 weights 20/30/50 with bounded scored effort',()=>{
 assert.equal(WEEKLY_INDOOR_SCORING_VERSION,'challenge-score-v1');
 assert.deepEqual(previewV1ScoreForParity({
  completionFraction:1,prescribedExecutionIndex:1,scoredEffortRelativeToFtp:1,
 }),{
  version:'challenge-score-v1',completionFraction:1,prescribedExecutionIndex:1,
  scoredEffortRelativeToFtp:1,completionPoints:20,executionPoints:30,scoredEffortPoints:25,score:75,
 });
 assert.equal(previewV1ScoreForParity({
  completionFraction:1,prescribedExecutionIndex:1,scoredEffortRelativeToFtp:2.3,
 }).score,100);
});
test('V1 clamp applies to over/under-range completion and execution inputs',()=>{
 const x=previewV1ScoreForParity({
  completionFraction:8,prescribedExecutionIndex:-0.2,scoredEffortRelativeToFtp:-0.8,
 });
 assert.equal(x.score,20);
 assert.equal(x.completionFraction,1);
 assert.equal(x.prescribedExecutionIndex,0);
 assert.equal(x.scoredEffortPoints,0);
});
test('V1 SQL null metric handling is preserved, not invented as verified telemetry',()=>{
 const x=previewV1ScoreForParity({
  completionFraction:null,prescribedExecutionIndex:null,scoredEffortRelativeToFtp:null,
 });
 assert.equal(x.score,0);
 assert.equal(x.scoredEffortRelativeToFtp,null);
});
test('QA input rejects non-finite readings rather than accidentally ranking them',()=>{
 assert.throws(()=>previewV1ScoreForParity({
  completionFraction:1,prescribedExecutionIndex:NaN,scoredEffortRelativeToFtp:2,
 }),/Invalid/);
 assert.throws(()=>previewV1ScoreForParity({
  completionFraction:1,prescribedExecutionIndex:1,scoredEffortRelativeToFtp:Infinity,
 }),/Invalid/);
});
const attempt=(overrides:Partial<VerifiedAttemptRankFixture>={}):VerifiedAttemptRankFixture=>({
 challengeId:'weekly-1',ownerId:'owner-A',attemptId:'attempt-A',
 score:80,scoredEffortRelativeToFtp:1.4,prescribedExecutionIndex:.9,
 completedAt:'2026-11-11T12:00:00Z',...overrides,
});
test('V1 ranked attempt QA follows score, effort, execution, time then attempt ID',()=>{
 const a=attempt();
 assert.ok(compareV1VerifiedAttemptsForParity(a,attempt({score:79,attemptId:'B'}))<0);
 assert.ok(compareV1VerifiedAttemptsForParity(a,attempt({scoredEffortRelativeToFtp:1.3,attemptId:'B'}))<0);
 assert.ok(compareV1VerifiedAttemptsForParity(a,attempt({prescribedExecutionIndex:.8,attemptId:'B'}))<0);
 assert.ok(compareV1VerifiedAttemptsForParity(a,attempt({completedAt:'2026-11-11T12:01:00Z',attemptId:'B'}))<0);
 assert.ok(compareV1VerifiedAttemptsForParity(a,attempt({attemptId:'attempt-B'}))<0);
});
test('best verified attempt ranking is not permitted across challenge weeks',()=>{
 assert.throws(()=>compareV1VerifiedAttemptsForParity(attempt(),attempt({challengeId:'weekly-2'})),/Incomparable/);
 assert.throws(()=>compareV1VerifiedAttemptsForParity(attempt(),attempt({score:NaN})),/Invalid/);
});
