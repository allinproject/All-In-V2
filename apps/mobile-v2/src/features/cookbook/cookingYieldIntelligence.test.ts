import test from 'node:test'; import assert from 'node:assert/strict';
import {aggregatePersonalYieldEvidence,assertNutritionWeightState,calculateBatchYield,reconcilePreparedIngredientAllocation,chooseCookingYieldEvidence,expectedCookedFromRaw,rawNeededForCookedTarget,sameCookingYieldKey,type CookingYieldEvidence,type CookingYieldKey} from './cookingYieldIntelligence.ts';
import {reviewedCookingYieldReferences} from './cookingYieldReferenceCatalog.ts';
const chicken:CookingYieldKey={food:'Chicken breast',form:'boneless skinless',method:'skillet',doneness:'cooked through',lid:'uncovered',drained:false};
const ref:CookingYieldEvidence={id:'usda-chicken-example',key:chicken,source:'usda_exact',yieldRatio:.75,lowerYieldRatio:.72,upperYieldRatio:.78};
test('exact identity matching never reuses another cooking method',()=>{assert.ok(chooseCookingYieldEvidence(chicken,[ref]));assert.equal(chooseCookingYieldEvidence({...chicken,method:'roasted'},[ref]),null);assert.equal(sameCookingYieldKey(chicken,{...chicken,drained:true}),false)});
test('raw/cooked conversions use the reviewed ratio and uncertainty range',()=>{const s=chooseCookingYieldEvidence(chicken,[ref]);assert.ok(s);assert.equal(expectedCookedFromRaw(100,s).grams,75);assert.equal(rawNeededForCookedTarget(75,s).grams,100);assert.deepEqual(expectedCookedFromRaw(100,s).range,{min:72,max:78})});
test('personal yield needs three exact observations before outranking reviewed data',()=>{const one=aggregatePersonalYieldEvidence({id:'p1',key:chicken,observations:[{rawOrDryGrams:100,cookedOrPreparedGrams:70}]});assert.equal(chooseCookingYieldEvidence(chicken,[one,ref])?.source,'usda_exact');const three=aggregatePersonalYieldEvidence({id:'p3',key:chicken,observations:[{rawOrDryGrams:100,cookedOrPreparedGrams:70},{rawOrDryGrams:100,cookedOrPreparedGrams:72},{rawOrDryGrams:100,cookedOrPreparedGrams:74}]});assert.equal(chooseCookingYieldEvidence(chicken,[three,ref])?.source,'personal_measured')});
test('batch mass balance and allocation use measured finished mass',()=>{const r=calculateBatchYield({startingFoodGrams:500,addedLiquidGrams:100,addedOtherGrams:20,discardedOrDrainedGrams:30,finalCookedGrams:450});assert.equal(r.startingTotalGrams,620);assert.equal(r.retainedGrams,480);assert.equal(r.finalToStartingRatio,450/620);assert.doesNotThrow(()=>reconcilePreparedIngredientAllocation({finishedCookedGrams:500,allocatedToMealsGrams:300,savedAsIngredientGrams:150,discardedGrams:50}));assert.throws(()=>reconcilePreparedIngredientAllocation({finishedCookedGrams:500,allocatedToMealsGrams:300,savedAsIngredientGrams:150,discardedGrams:20}))});
test('nutrition basis and measured state must agree',()=>{assert.doesNotThrow(()=>assertNutritionWeightState({nutritionState:'cooked',measuredState:'cooked'}));assert.throws(()=>assertNutritionWeightState({nutritionState:'raw',measuredState:'cooked'}))});
test('reviewed USDA yield catalog does not infer unsupported potato preparations',()=>{assert.ok(reviewedCookingYieldReferences.length>=4);const baked=chooseCookingYieldEvidence({food:'Potato',form:'White or Russet whole with skin',method:'baked',lid:'uncovered',drained:false},reviewedCookingYieldReferences);assert.equal(baked?.yieldRatio,.82);assert.equal(chooseCookingYieldEvidence({food:'Potato',form:'peeled mashed',method:'boiled and mashed',drained:true},reviewedCookingYieldReferences),null)});

test('yield quantity conversions reject overflow and non-finite uncertainty bounds',()=>{
 const tiny={yieldRatio:Number.MIN_VALUE,lowerYieldRatio:null,upperYieldRatio:null,source:'reviewed_reference' as const,confidence:'medium' as const,evidenceId:'tiny',observationCount:null};
 assert.throws(()=>rawNeededForCookedTarget(100,tiny),/finite and positive/);
 const high={...tiny,yieldRatio:10};
 assert.throws(()=>expectedCookedFromRaw(1e308,high),/finite and positive/);
 const overflowRange={...tiny,yieldRatio:1,lowerYieldRatio:Number.MIN_VALUE,upperYieldRatio:1};
 assert.throws(()=>rawNeededForCookedTarget(100,overflowRange),/finite and positive/);
 const nominal={...tiny,yieldRatio:.75,lowerYieldRatio:.72,upperYieldRatio:.78};
 assert.equal(rawNeededForCookedTarget(75,nominal).grams,100);
});
