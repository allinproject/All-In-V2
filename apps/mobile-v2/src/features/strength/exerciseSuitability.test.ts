import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateExerciseSuitability,type ExerciseSuitabilityOwnerSnapshots} from './exerciseSuitability.ts';
import type {ExerciseScienceProfile} from './exerciseScienceProfile.ts';
import type {AthleteRestriction} from '../training/athleteHistoryContext.ts';

const profile=():ExerciseScienceProfile=>({
 schemaVersion:1,publicationState:'reviewed',movementId:'movement-squat',variationId:'variation-goblet-squat',
 displayName:'Goblet squat',aliases:['dumbbell goblet squat'],variationDescription:'Dumbbell held at chest; bilateral squat.',
 movementPattern:'squat',laterality:'bilateral',contractionModes:['concentric','eccentric'],skillLevel:'beginner',
 equipmentRequiredIds:['dumbbell'],equipmentOptionalIds:[],
 muscleGroups:[
  {muscleGroupId:'quadriceps',role:'primary',sourceIds:['source-running']},
  {muscleGroupId:'gluteals',role:'primary',sourceIds:['source-running']},
 ],
 jointDemands:[{jointId:'knee',action:'flexion and extension',plane:'sagittal',rangeOfMotion:'variable',relativeDemand:'moderate',sourceIds:['source-running']}],
 cautionFlags:[],coachingCues:{setup:['Hold close to chest.'],execution:['Brace and squat.'],commonErrors:['Allowing the weight to drift.']},
 progressionVariationIds:[],regressionVariationIds:['variation-box-squat'],alternativeVariationIds:[],
 sources:[{id:'source-running',title:'Running strength intervention review',url:'https://example.org/running',publishedYear:2024,sourceType:'systematic_review_or_meta_analysis',doi:null,pmid:'10000001'}],
 claims:[{id:'claim-running',claimType:'sport_transfer',statement:'High-load strength methods may improve measured running performance in the studied middle- and long-distance runner populations.',population:'Middle- and long-distance runners in the reviewed controlled studies.',targetSports:['running'],targetGoals:['sport_performance'],directness:'direct_sport_outcome',evidenceTier:'systematic_review_or_meta_analysis',confidence:'moderate',sourceIds:['source-running'],limitations:'This intervention-level result does not prove this exact variation is superior or guarantee an individual race outcome.'}],
});

const context=():ExerciseSuitabilityOwnerSnapshots=>({
 goals:{owner:'ALL-239',status:'complete',active:[{goalId:'goal-trail-race',role:'primary',sports:['running'],exerciseGoals:['sport_performance']}]},
 location:{owner:'ALL-251',status:'complete',selectedLocationId:'home',confirmedEquipmentIds:['dumbbell']},
 restrictions:{owner:'ALL-232',status:'complete',active:[]},
 strengthExperience:{owner:'ALL-257',status:'complete',skillLevel:'beginner'},
 trainingLoad:{owner:'ALL-246',status:'complete',nextSessionConflict:'clear',conflictingMuscleGroupIds:[]},
});

const restriction=(category:AthleteRestriction['category'],subject:string):AthleteRestriction=>({
 id:'restriction-1',category,subject,status:'active',source:'explicit_user',updatedAt:'2026-11-10T12:00:00-06:00',reason:null,
});

test('returns a sourced movement explanation for a matched sport goal with the exact canonical IDs',()=>{
 const result=evaluateExerciseSuitability(profile(),context());
 assert.equal(result.status,'recommended');
 if(result.status!=='recommended')return;
 assert.equal(result.movementId,'movement-squat');
 assert.equal(result.variationId,'variation-goblet-squat');
 assert.deepEqual(result.matchedGoalIds,['goal-trail-race']);
 assert.deepEqual(result.matchedSports,['running']);
 assert.equal(result.transfer,'direct_sport_evidence');
 assert.match(result.whyThisFits[0],/running performance/);
 assert.equal(result.evidence[0].claimId,'claim-running');
 assert.deepEqual(result.evidence[0].sourceIds,['source-running']);
 assert.equal(result.noDoseOrPlanWrite,true);
});

test('general adaptation is clearly labeled as indirect and never upgraded to direct sport proof',()=>{
 const candidate=profile();
 candidate.claims=[{...candidate.claims[0],id:'general',claimType:'general_adaptation',targetSports:['general_fitness'],directness:'general_training_adaptation',statement:'Resistance training can improve maximal strength in the reviewed population.'}];
 candidate.sources=[{...candidate.sources[0],id:'general-source'}];
 candidate.muscleGroups=candidate.muscleGroups.map(x=>({...x,sourceIds:['general-source']}));
 candidate.jointDemands=candidate.jointDemands.map(x=>({...x,sourceIds:['general-source']}));
 candidate.claims[0].sourceIds=['general-source'];
 const result=evaluateExerciseSuitability(candidate,context());
 assert.equal(result.status,'recommended');
 if(result.status!=='recommended')return;
 assert.equal(result.transfer,'general_adaptation_indirect_transfer');
 assert.equal(result.evidence[0].directness,'general_training_adaptation');
});

test('unknown or incomplete owner snapshots prevent a movement recommendation',()=>{
 for(const change of [
  (c:ExerciseSuitabilityOwnerSnapshots)=>{c.goals.status='partial';},
  (c:ExerciseSuitabilityOwnerSnapshots)=>{c.location.status='unknown';},
  (c:ExerciseSuitabilityOwnerSnapshots)=>{c.restrictions.status='partial';},
  (c:ExerciseSuitabilityOwnerSnapshots)=>{c.strengthExperience.status='unknown';},
  (c:ExerciseSuitabilityOwnerSnapshots)=>{c.trainingLoad.status='partial';},
 ]){
  const c=context();change(c);
  const result=evaluateExerciseSuitability(profile(),c);
  assert.equal(result.status,'review_required');
 }
});

test('unknown lifting experience does not silently assume a safe skill match',()=>{
 const c=context();c.strengthExperience.skillLevel='unknown';
 const result=evaluateExerciseSuitability(profile(),c);
 assert.equal(result.status,'review_required');
});

test('advanced variation is not proposed to an athlete below its skill requirement',()=>{
 const candidate=profile();candidate.skillLevel='advanced';
 const result=evaluateExerciseSuitability(candidate,context());
 assert.equal(result.status,'review_required');
 if(result.status==='review_required')assert.ok(result.reasonCodes.includes('MOVEMENT_SKILL_EXCEEDS_CONFIRMED_EXPERIENCE'));
});

test('required equipment must be in the selected location confirmed inventory',()=>{
 const c=context();c.location.confirmedEquipmentIds=[];
 const result=evaluateExerciseSuitability(profile(),c);
 assert.equal(result.status,'blocked');
 if(result.status==='blocked')assert.ok(result.reasonCodes.includes('REQUIRED_EQUIPMENT_UNAVAILABLE'));
});

test('active exact exercise, alias or movement-pattern restriction blocks the movement',()=>{
 for(const subject of ['variation-goblet-squat','dumbbell goblet squat','squat']){
  const c=context();c.restrictions.active=[restriction('exercise',subject)];
  const result=evaluateExerciseSuitability(profile(),c);
  assert.equal(result.status,'blocked',subject);
 }
});

test('unmapped exercise restrictions and pain/return restrictions require owner review',()=>{
 const exercise=context();exercise.restrictions.active=[restriction('exercise','no heavy lower body')];
 assert.equal(evaluateExerciseSuitability(profile(),exercise).status,'review_required');
 const pain=context();pain.restrictions.active=[restriction('pain_or_return','knee pain')];
 assert.equal(evaluateExerciseSuitability(profile(),pain).status,'review_required');
});

test('equipment restrictions block the exact required equipment',()=>{
 const c=context();c.restrictions.active=[restriction('equipment','dumbbell')];
 const result=evaluateExerciseSuitability(profile(),c);
 assert.equal(result.status,'blocked');
});

test('a next-session load conflict or unknown conflict cannot be bypassed by Coach',()=>{
 const conflict=context();conflict.trainingLoad.nextSessionConflict='conflict';conflict.trainingLoad.conflictingMuscleGroupIds=['quadriceps'];
 assert.equal(evaluateExerciseSuitability(profile(),conflict).status,'review_required');
 const unknown=context();unknown.trainingLoad.nextSessionConflict='unknown';
 assert.equal(evaluateExerciseSuitability(profile(),unknown).status,'review_required');
});

test('only mechanistic reasoning cannot be presented as an athlete benefit',()=>{
 const candidate=profile();
 candidate.claims=[{...candidate.claims[0],directness:'mechanistic_rationale',evidenceTier:'biomechanical_study',claimType:'movement_demand'}];
 const result=evaluateExerciseSuitability(candidate,context());
 assert.equal(result.status,'not_supported');
 if(result.status==='not_supported')assert.ok(result.reasonCodes.includes('MECHANISTIC_RATIONALE_ONLY'));
});

test('maintenance-only and mismatched sport or goal claims do not become recommendations',()=>{
 const c=context();c.goals.active=[{goalId:'goal-maintenance',role:'maintenance',sports:['running'],exerciseGoals:['sport_performance']}];
 assert.equal(evaluateExerciseSuitability(profile(),c).status,'not_supported');
 const mismatched=profile();mismatched.claims=[{...mismatched.claims[0],targetSports:['cycling']}];
 assert.equal(evaluateExerciseSuitability(mismatched,context()).status,'not_supported');
});

test('unreviewed or draft profiles are not eligible for movement selection',()=>{
 const candidate=profile();candidate.publicationState='draft';
 assert.equal(evaluateExerciseSuitability(candidate,context()).status,'review_required');
});

test('never emits sets, reps, weights, volume, or a Training plan mutation',()=>{
 const result=evaluateExerciseSuitability(profile(),context());
 assert.equal(result.status,'recommended');
 if(result.status==='recommended'){
  assert.equal('sets' in result,false);
  assert.equal('reps' in result,false);
  assert.equal('load' in result,false);
  assert.equal('trainingPlan' in result,false);
  assert.equal(result.noDoseOrPlanWrite,true);
 }
});

test('malformed persisted owner snapshots fail closed instead of bypassing the skill gate',()=>{
 const invalidSkill=context();(invalidSkill.strengthExperience as any).skillLevel='expert';
 assert.equal(evaluateExerciseSuitability(profile(),invalidSkill).status,'review_required');
 const invalidGoal=context();(invalidGoal.goals.active as any)=[null];
 assert.equal(evaluateExerciseSuitability(profile(),invalidGoal).status,'review_required');
 const invalidEquipment=context();(invalidEquipment.location.confirmedEquipmentIds as any)=[null];
 assert.equal(evaluateExerciseSuitability(profile(),invalidEquipment).status,'review_required');
 const invalidRestriction=context();(invalidRestriction.restrictions.active as any)=[{status:'active',category:'unknown',subject:'x'}];
 assert.equal(evaluateExerciseSuitability(profile(),invalidRestriction).status,'review_required');
});
