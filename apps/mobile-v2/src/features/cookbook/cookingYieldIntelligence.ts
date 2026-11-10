export type CookingYieldEvidenceSource='personal_measured'|'usda_exact'|'usda_category'|'reviewed_reference'|'estimate';
export type CookingYieldConfidence='high'|'medium'|'low'|'unknown';
export type FoodWeightState='raw'|'cooked'|'dry'|'prepared'|'drained'|'as_sold';

export type CookingYieldKey={
  food:string;
  form?:string|null;
  method?:string|null;
  doneness?:string|null;
  lid?:'covered'|'uncovered'|'mixed'|null;
  drained?:boolean|null;
};

export type CookingYieldEvidence={
  id:string;
  key:CookingYieldKey;
  source:CookingYieldEvidenceSource;
  yieldRatio:number;
  lowerYieldRatio?:number|null;
  upperYieldRatio?:number|null;
  observationCount?:number|null;
  measuredAt?:string|null;
  reference?:string|null;
};

export type CookingYieldSelection={
  yieldRatio:number;
  lowerYieldRatio:number|null;
  upperYieldRatio:number|null;
  source:CookingYieldEvidenceSource;
  confidence:CookingYieldConfidence;
  evidenceId:string;
  observationCount:number|null;
};

export type BatchYieldObservation={
  startingFoodGrams:number;
  addedLiquidGrams:number;
  addedOtherGrams?:number;
  discardedOrDrainedGrams?:number;
  finalCookedGrams:number;
};

export type BatchYieldResult={
  startingTotalGrams:number;
  retainedGrams:number;
  netLossGrams:number;
  netLossRatio:number;
  finalToStartingRatio:number;
};

const SOURCE_PRIORITY:Record<CookingYieldEvidenceSource,number>={personal_measured:5,usda_exact:4,reviewed_reference:3,usda_category:2,estimate:1};

export function cookingYieldKeyId(key:CookingYieldKey):string{
  return [norm(key.food),norm(key.form),norm(key.method),norm(key.doneness),key.lid||'',key.drained==null?'':key.drained?'drained':'not_drained'].join('|');
}

export function chooseCookingYieldEvidence(key:CookingYieldKey,evidence:CookingYieldEvidence[]):CookingYieldSelection|null{
  const target=cookingYieldKeyId(key);
  const exact=evidence.filter(row=>cookingYieldKeyId(row.key)===target).map(validateEvidence);
  if(!exact.length)return null;
  const eligible=exact.filter(row=>row.source!=='personal_measured'||(row.observationCount??1)>=3);
  const pool=eligible.length?eligible:exact.filter(row=>row.source!=='personal_measured');
  if(!pool.length)return null;
  pool.sort((a,b)=>SOURCE_PRIORITY[b.source]-SOURCE_PRIORITY[a.source]||((b.observationCount??0)-(a.observationCount??0))||String(b.measuredAt??'').localeCompare(String(a.measuredAt??'')));
  const best=pool[0];
  return {yieldRatio:best.yieldRatio,lowerYieldRatio:best.lowerYieldRatio??null,upperYieldRatio:best.upperYieldRatio??null,source:best.source,confidence:confidence(best),evidenceId:best.id,observationCount:best.observationCount??null};
}

export function rawNeededForCookedTarget(targetCookedGrams:number,selection:CookingYieldSelection):{grams:number;range:{min:number;max:number}|null}{
  positive(targetCookedGrams,'Cooked target');
  validateRatio(selection.yieldRatio,'Yield ratio');
  const grams=targetCookedGrams/selection.yieldRatio;
  const lo=selection.lowerYieldRatio,hi=selection.upperYieldRatio;
  const range=lo!=null&&hi!=null?{min:targetCookedGrams/hi,max:targetCookedGrams/lo}:null;
  return {grams,range};
}

export function expectedCookedFromRaw(rawGrams:number,selection:CookingYieldSelection):{grams:number;range:{min:number;max:number}|null}{
  positive(rawGrams,'Raw amount');
  validateRatio(selection.yieldRatio,'Yield ratio');
  const grams=rawGrams*selection.yieldRatio;
  const lo=selection.lowerYieldRatio,hi=selection.upperYieldRatio;
  const range=lo!=null&&hi!=null?{min:rawGrams*lo,max:rawGrams*hi}:null;
  return {grams,range};
}

export function measuredYieldEvidence(args:{id:string;key:CookingYieldKey;rawOrDryGrams:number;cookedOrPreparedGrams:number;measuredAt?:string|null;reference?:string|null}):CookingYieldEvidence{
  positive(args.rawOrDryGrams,'Starting weight');positive(args.cookedOrPreparedGrams,'Finished weight');
  return {id:req(args.id,'Evidence ID'),key:args.key,source:'personal_measured',yieldRatio:args.cookedOrPreparedGrams/args.rawOrDryGrams,observationCount:1,measuredAt:args.measuredAt??null,reference:args.reference??null};
}

export function aggregatePersonalYieldEvidence(args:{id:string;key:CookingYieldKey;observations:Array<{rawOrDryGrams:number;cookedOrPreparedGrams:number}>}):CookingYieldEvidence{
  if(args.observations.length<1)throw new Error('At least one measured cooking yield is required.');
  const ratios=args.observations.map(row=>{positive(row.rawOrDryGrams,'Starting weight');positive(row.cookedOrPreparedGrams,'Finished weight');return row.cookedOrPreparedGrams/row.rawOrDryGrams}).sort((a,b)=>a-b);
  const median=quantile(ratios,.5);const lower=ratios.length>=3?quantile(ratios,.2):null;const upper=ratios.length>=3?quantile(ratios,.8):null;
  return {id:req(args.id,'Evidence ID'),key:args.key,source:'personal_measured',yieldRatio:median,lowerYieldRatio:lower,upperYieldRatio:upper,observationCount:ratios.length};
}

export function calculateBatchYield(input:BatchYieldObservation):BatchYieldResult{
  nonnegative(input.startingFoodGrams,'Starting food weight');nonnegative(input.addedLiquidGrams,'Added liquid');nonnegative(input.addedOtherGrams??0,'Other added weight');nonnegative(input.discardedOrDrainedGrams??0,'Discarded weight');positive(input.finalCookedGrams,'Final cooked weight');
  const startingTotalGrams=input.startingFoodGrams+input.addedLiquidGrams+(input.addedOtherGrams??0);
  if(startingTotalGrams<=0)throw new Error('Batch starting weight must be positive.');
  const retainedGrams=input.finalCookedGrams+(input.discardedOrDrainedGrams??0);
  const netLossGrams=startingTotalGrams-retainedGrams;
  return {startingTotalGrams,retainedGrams,netLossGrams,netLossRatio:netLossGrams/startingTotalGrams,finalToStartingRatio:input.finalCookedGrams/startingTotalGrams};
}

/** Cooked ingredient allocation is one physical mass balance, not an
 * additional meal or Pantry credit. All values are actual measured grams in
 * the same cooked/prepared state; conversion and provenance are reviewed first.
 * This is a pure preflight check; canonical completion must commit atomically.
 */
export function reconcilePreparedIngredientAllocation(input:{
 finishedCookedGrams:number;
 allocatedToMealsGrams:number;
 savedAsIngredientGrams:number;
 discardedGrams:number;
}):{finishedCookedGrams:number;allocatedToMealsGrams:number;savedAsIngredientGrams:number;discardedGrams:number}{
 positive(input.finishedCookedGrams,'Finished cooked ingredient weight');
 nonnegative(input.allocatedToMealsGrams,'Cooked amount allocated to meals');
 nonnegative(input.savedAsIngredientGrams,'Cooked amount saved to Pantry');
 nonnegative(input.discardedGrams,'Cooked amount discarded');
 const used=input.allocatedToMealsGrams+input.savedAsIngredientGrams+input.discardedGrams;
 // Weights are weighed, not invented: require the full output allocation.
 if(Math.abs(input.finishedCookedGrams-used)>0.05)
  throw new Error('Cooked ingredient allocations must equal measured finished weight. Review meals, saved leftovers and discarded amount.');
 return {...input};
}

export function assertNutritionWeightState(args:{nutritionState:FoodWeightState;measuredState:FoodWeightState}){
  if(args.nutritionState!==args.measuredState)throw new Error(`Nutrition basis is ${args.nutritionState} but measured weight is ${args.measuredState}. Convert weight state before calculating nutrition.`);
}

export function sameCookingYieldKey(a:CookingYieldKey,b:CookingYieldKey){return cookingYieldKeyId(a)===cookingYieldKeyId(b)}

function validateEvidence(row:CookingYieldEvidence):CookingYieldEvidence{req(row.id,'Evidence ID');validateRatio(row.yieldRatio,'Yield ratio');if(row.lowerYieldRatio!=null)validateRatio(row.lowerYieldRatio,'Lower yield ratio');if(row.upperYieldRatio!=null)validateRatio(row.upperYieldRatio,'Upper yield ratio');if(row.lowerYieldRatio!=null&&row.upperYieldRatio!=null&&row.lowerYieldRatio>row.upperYieldRatio)throw new Error('Yield confidence range is invalid.');if(row.observationCount!=null&&(!Number.isInteger(row.observationCount)||row.observationCount<1))throw new Error('Observation count is invalid.');return row}
function confidence(row:CookingYieldEvidence):CookingYieldConfidence{if(row.source==='personal_measured')return (row.observationCount??0)>=5?'high':'medium';if(row.source==='usda_exact')return 'high';if(row.source==='reviewed_reference'||row.source==='usda_category')return 'medium';if(row.source==='estimate')return 'low';return'unknown'}
function validateRatio(v:number,label:string){if(!Number.isFinite(v)||v<=0||v>10)throw new Error(`${label} is invalid.`)}
function positive(v:number,label:string){if(!Number.isFinite(v)||v<=0)throw new Error(`${label} must be positive.`)}
function nonnegative(v:number,label:string){if(!Number.isFinite(v)||v<0)throw new Error(`${label} must be zero or greater.`)}
function req(v:string,label:string){const s=String(v??'').trim();if(!s)throw new Error(`${label} is required.`);return s}
function norm(v:any){return String(v??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function quantile(sorted:number[],p:number){if(sorted.length===1)return sorted[0];const pos=(sorted.length-1)*p;const lo=Math.floor(pos),hi=Math.ceil(pos);if(lo===hi)return sorted[lo];return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo)}