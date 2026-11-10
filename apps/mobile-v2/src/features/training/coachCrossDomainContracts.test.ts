/**
 * ALL-241 dependency-free, cross-domain source-contract fixtures.
 * These use real V2 deterministic modules, NOT a model response or Supabase
 * integration. They never publish a plan, log food, or fetch provider data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAthleteHistoryReadModel, type AthleteRestriction } from './athleteHistoryContext.ts';
import { synthesizeTrainingWeek, adaptTrainingDay, type TrainingSessionIntent } from './trainingPlanSynthesis.ts';
import { validateRaceCourseEvidence, type RaceCourseEvidence } from './raceCourseEvidence.ts';
import { calculateRecipeFromLocalCatalog, type LocalIngredientCatalog } from '../cookbook/localIngredientProfiles.ts';

const keyRun = ():TrainingSessionIntent=>({
 id:'key-run',sport:'running',label:'Key trail run',purpose:'Trail event preparation',
 priority:'key',intensity:'moderate',durationMinutes:90,
 demand:{aerobic:'high',mechanicalImpact:'high',localMuscular:'moderate',technicalSkill:'moderate'},
 stressTags:['trail running'],evidenceRefs:['athlete-approved-goal'],
});
const restriction:AthleteRestriction={id:'no-impact',category:'exercise',
 subject:'trail running',status:'active',source:'explicit_user',
 updatedAt:'2026-11-08T00:00:00Z',reason:'No trail impact until reviewed'};

test('athlete-history restrictions block a Coach proposal through the actual Training planner',()=>{
 const history=buildAthleteHistoryReadModel({
  generatedAt:'2026-11-10T12:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',
  sports:['running'],currentPlan:{id:'approved-plan',revision:2,weekStart:'2026-11-09',status:'accepted'},
  restrictions:[restriction],coverage:[{sport:'running',fromDate:'2026-10-01',throughDate:'2026-11-09',
   status:'partial',lastSyncAt:'2026-11-09T00:00:00Z',
   missingIntervals:[{fromDate:'2026-11-04',throughDate:'2026-11-05',reason:'watch disconnected'}]}],
  events:[],
 });
 assert.equal(history.completeness,'partial');
 assert.equal(history.currentPlan?.revision,2);
 const draft=synthesizeTrainingWeek({
  primaryGoal:{id:'trail-race',label:'Trail race',sports:['running']},
  secondaryGoals:[],requiredSports:['running'],
  availableDays:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],
  activeRestrictions:history.restrictions.map(r=>r.subject),
 },[keyRun()]);
 assert.equal(draft.status,'blocked');
 assert.ok(draft.issues.some(i=>i.code==='EXERCISE_RESTRICTED'));
 assert.equal(draft.invariants.noAutomaticPlanWrite,true);
 assert.equal(draft.days.flatMap(d=>d.sessions).length,0);
});

test('unverified race aid stations remain unknown alongside an otherwise reviewable run',()=>{
 const field=<T,>(value:T|null)=>({value,source:value===null?null:'official_race_website' as const,
  sourceUrl:value===null?null:'https://race.example/course',
  retrievedAt:value===null?null:'2026-11-09T12:00:00Z',confirmedByUser:false});
 const course:RaceCourseEvidence={
  version:1,raceId:'trail-50',eventDate:'2027-09-18',sourceUrls:['https://race.example/course'],
  routeFile:null,distance:field(80467),elevationGain:field<number>(null),elevationLoss:field<number>(null),
  surface:field<'trail'>('trail'),technicality:field<'moderate'>('moderate'),aidStationStatus:field<'unknown'>('unknown'),
  aidStations:[],courseVersion:'2027-draft',completeness:'unverified',warnings:[],missingFields:[],
 };
 const verified=validateRaceCourseEvidence(course);
 assert.equal(verified.completeness,'partial');
 assert.ok(verified.missingFields.includes('aid_stations'));
 assert.equal(verified.aidStations.length,0);
 const proposal=synthesizeTrainingWeek({
  primaryGoal:{id:'trail-race',label:'Trail race',sports:['running']},
  secondaryGoals:[],availableDays:['saturday'],requiredSports:['running'],activeRestrictions:[],
 },[keyRun()]);
 assert.equal(proposal.status,'review_required');
 assert.equal(proposal.invariants.noInventedPrescription,true);
 // A reviewable training draft does not certify unverified aid-station facts.
 assert.notEqual(verified.completeness,'verified');
});

test('Cookbook calculates reviewed local food only; missing profile cannot become Coach fueling fact',()=>{
 const catalog:LocalIngredientCatalog={
  ingredients:[{id:'rice',status:'active'},{id:'sauce',status:'active'}],
  aliases:[{ingredient_id:'rice',normalized_alias:'rice cooked',locale:'en',preparation_state:'cooked',status:'active'},
           {ingredient_id:'sauce',normalized_alias:'house sauce',locale:'en',preparation_state:'prepared',status:'active'}],
  profiles:[{id:'rice-cooked',ingredient_id:'rice',preparation_state:'cooked',basis_unit:'g',basis_quantity:100,
   basis_label:'100 g',profile_revision:1,review_status:'calculation_ready',is_default:true,source_record_id:'fdc-rice'}],
  nutrients:[
   {profile_id:'rice-cooked',nutrient_code:'energy_kcal',amount:130},
   {profile_id:'rice-cooked',nutrient_code:'protein_g',amount:2.7},
   {profile_id:'rice-cooked',nutrient_code:'carbohydrate_g',amount:28},
   {profile_id:'rice-cooked',nutrient_code:'total_fat_g',amount:0.3},
  ],
 };
 const valid=calculateRecipeFromLocalCatalog({catalog,recipe_id:'race-meal',recipe_state_version:'1',servings:1,
  ingredients:[{line_id:'rice-line',label:'rice cooked',preparation_state:'cooked',quantity_g:100}]});
 assert.equal(valid.status,'validated');
 const incomplete=calculateRecipeFromLocalCatalog({catalog,recipe_id:'race-meal',recipe_state_version:'2',servings:1,
  ingredients:[{line_id:'rice-line',label:'rice cooked',preparation_state:'cooked',quantity_g:100},
               {line_id:'sauce-line',label:'house sauce',preparation_state:'prepared',quantity_g:20}]});
 assert.equal(incomplete.status,'insufficient_evidence');
 if(incomplete.status==='insufficient_evidence')
  assert.ok(incomplete.reasons.includes('local_ingredient_state_mismatch:sauce-line'));
});

test('incomplete wearable recovery does not rewrite a key session, but pain prompts review',()=>{
 const history=buildAthleteHistoryReadModel({
  generatedAt:'2026-11-10T12:00:00Z',fromDate:'2026-10-01',throughDate:'2026-11-09',
  sports:['running'],currentPlan:{id:'approved-plan',revision:2,weekStart:'2026-11-09',status:'accepted'},
  restrictions:[],coverage:[],events:[],
 });
 assert.equal(history.completeness,'unavailable');
 const unknown=adaptTrainingDay({planned:keyRun(),report:{
  fatigue:'unknown',soreness:'unknown',sleep:'unknown',performance:'unknown',painOrIllnessConcern:false,
 },recentPattern:'unknown'});
 assert.equal(unknown.action,'keep');
 assert.equal(unknown.confidence,'low');
 assert.equal(unknown.preservesOriginalPlan,true);
 assert.equal(unknown.requiresAthleteApproval,true);
 const concern=adaptTrainingDay({planned:keyRun(),report:{
  fatigue:'high',soreness:'severe',sleep:'poor',performance:'below_expected',painOrIllnessConcern:true,
 },recentPattern:'unknown'});
 assert.equal(concern.action,'review');
 assert.equal(concern.requiresAthleteApproval,true);
 assert.equal(concern.preservesOriginalPlan,true);
});
