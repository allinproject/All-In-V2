import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExerciseScienceProfile,type ExerciseScienceProfile} from './exerciseScienceProfile.ts';

const valid=():ExerciseScienceProfile=>({
 schemaVersion:1,publicationState:'reviewed',
 movementId:'movement-squat',variationId:'variation-goblet-squat',
 displayName:'Goblet squat',aliases:['dumbbell goblet squat'],
 variationDescription:'Dumbbell held at chest; bilateral squat through athlete-tolerated range.',
 movementPattern:'squat',laterality:'bilateral',contractionModes:['concentric','eccentric'],
 skillLevel:'beginner',equipmentRequiredIds:['dumbbell'],equipmentOptionalIds:['box'],
 muscleGroups:[
  {muscleGroupId:'quadriceps',role:'primary',sourceIds:['review-1']},
  {muscleGroupId:'gluteals',role:'primary',sourceIds:['review-1']},
  {muscleGroupId:'trunk',role:'secondary',sourceIds:['review-1']},
 ],
 jointDemands:[{jointId:'knee',action:'flexion and extension',plane:'sagittal',rangeOfMotion:'variable',relativeDemand:'moderate',sourceIds:['review-1']}],
 cautionFlags:[{flagId:'deep-knee-flexion-demand',description:'Depth changes knee and hip demands; adapt only to the athlete-approved range.',sourceIds:['review-1']}],
 coachingCues:{setup:['Hold the dumbbell close to the chest.'],execution:['Brace and sit between the hips.'],commonErrors:['Allowing the dumbbell to drift away from the torso.']},
 progressionVariationIds:['variation-front-squat'],regressionVariationIds:['variation-box-squat'],alternativeVariationIds:['variation-leg-press'],
 sources:[{id:'review-1',title:'Exercise profile source fixture',url:'https://example.org/review',publishedYear:2024,sourceType:'systematic_review_or_meta_analysis',doi:null,pmid:'12345678'}],
 claims:[{id:'claim-1',claimType:'general_adaptation',statement:'This profile fixture supports a bounded general strength adaptation claim.',population:'Healthy adults represented in the cited source.',targetSports:['general_fitness'],targetGoals:['maximal_strength'],directness:'general_training_adaptation',evidenceTier:'systematic_review_or_meta_analysis',confidence:'moderate',sourceIds:['review-1'],limitations:'Does not establish this exact variation as superior or guarantee sport performance transfer.'}],
});

test('reviewed source-linked variation can be eligible for Coach',()=>{
 const result=validateExerciseScienceProfile(valid());
 assert.deepEqual(result,{valid:true,coachEligible:true,sourceCount:1,claimCount:1});
});

test('draft profile is structurally valid but never presented as Coach-ready',()=>{
 const profile=valid();profile.publicationState='draft';
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,true);
 if(result.valid)assert.equal(result.coachEligible,false);
});

test('unsourced exercise claims cannot become Coach guidance',()=>{
 const profile=valid();profile.claims[0].sourceIds=['missing-source'];
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
 if(!result.valid)assert.ok(result.errors.some((error)=>error.includes('registered source records')));
});

test('mechanistic reasoning cannot be mislabeled as direct athlete outcome evidence',()=>{
 const profile=valid();
 profile.claims[0].directness='mechanistic_rationale';
 profile.claims[0].evidenceTier='systematic_review_or_meta_analysis';
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
 if(!result.valid)assert.ok(result.errors.some((error)=>error.includes('Mechanistic rationale')));
});

test('variation-specific written cues are required even when demonstration media is absent',()=>{
 const profile=valid();profile.coachingCues.execution=[];
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
 if(!result.valid)assert.ok(result.errors.some((error)=>error.includes('written cues')));
});

test('source URLs must be secure and claim limitations cannot be omitted',()=>{
 const profile=valid();profile.sources[0].url='http://example.org/review';profile.claims[0].limitations='';
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
 if(!result.valid)assert.ok(result.errors.some((error)=>error.includes('HTTPS')));
 if(!result.valid)assert.ok(result.errors.some((error)=>error.includes('limitations')));
});

test('invalid alias duplication, equipment and self-referencing substitutions fail closed',()=>{
 const profile=valid();
 profile.aliases=['Goblet Squat',' goblet squat '];
 profile.equipmentRequiredIds=['dumbbell','dumbbell'];
 profile.alternativeVariationIds=['variation-goblet-squat'];
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
 if(!result.valid)assert.ok(result.errors.length>=3);
});

test('muscle emphasis must be variation-specific and source-linked',()=>{
 const profile=valid();
 profile.muscleGroups[0].sourceIds=['unknown-source'];
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
 if(!result.valid)assert.ok(result.errors.some((error)=>error.includes('muscle-group role')));
});
test('invalid runtime taxonomy values fail closed even when data bypasses TypeScript types',()=>{
 const profile=valid() as any;
 profile.movementPattern='generic_everything';
 profile.jointDemands[0].plane='unknown_plane';
 profile.claims[0].confidence='certain';
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
 if(!result.valid){
  assert.ok(result.errors.some((error)=>error.includes('Movement pattern')));
  assert.ok(result.errors.some((error)=>error.includes('joint')));
  assert.ok(result.errors.some((error)=>error.includes('confidence')));
 }
});
test('a profile without claims or references is never Coach-eligible',()=>{
 const profile=valid();profile.claims=[];profile.sources=[];
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,true);
 if(result.valid)assert.equal(result.coachEligible,false);
});

test('malformed persisted profile collections return validation errors instead of throwing',()=>{
 const profile=valid() as any;
 profile.sources={bad:'shape'};
 profile.muscleGroups=[null];
 profile.jointDemands={bad:'shape'};
 profile.cautionFlags=[null];
 profile.claims={bad:'shape'};
 assert.doesNotThrow(()=>validateExerciseScienceProfile(profile));
 const result=validateExerciseScienceProfile(profile);
 assert.equal(result.valid,false);
});
