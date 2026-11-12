/**
 * ALL-248 — pure Food Plan → Shopping projection, not a duplicate store or writer.
 * Inputs are reviewed, complete owner-scoped snapshots supplied by canonical readers.
 * No pantry mutation, product lookup, unit conversion, pricing or package rounding.
 */
export type MealSlot='breakfast'|'lunch'|'dinner'|'snack';
export type ExactNeed={foodId:string;preparationState:string;unit:string;perServing:number};
export type UnknownNeed={foodId:string|null;reason:'unknown_identity'|'unknown_amount'|'unknown_unit'|'unreviewed_conversion'|'unknown_preparation'};
export type PlannedKitchenOccurrence={
 id:string;localDate:string;mealSlot:MealSlot;kind:'food'|'recipe';sourceId:string;
 servings:number;preparedCoveredServings?:number;requirements:readonly (ExactNeed|UnknownNeed)[];
};
export type AvailablePantryLot={
 foodId:string;preparationState:string;unit:string;onHand:number;reserved:number;
};
export type ProjectedNeed={
 foodId:string;preparationState:string;unit:string;required:number;available:number;
 shortage:number;occurrenceIds:string[];
};
export type UnresolvedNeed={
 occurrenceId:string;sourceId:string;foodId:string|null;reason:UnknownNeed['reason'];
};
const slots=new Set(['breakfast','lunch','dinner','snack']);
const reasons=new Set(['unknown_identity','unknown_amount','unknown_unit','unreviewed_conversion','unknown_preparation']);
const exactDate=(date:string)=>{
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const parsed=new Date(date+'T00:00:00Z');
 return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===date;
};
const identity=(v:unknown):v is string=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=160;
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const key=(foodId:string,state:string,unit:string)=>JSON.stringify([foodId,state,unit]);
export function projectFoodPlanShopping(input:{
 occurrences:readonly PlannedKitchenOccurrence[];pantry:readonly AvailablePantryLot[];
}):{demands:ProjectedNeed[];shortages:ProjectedNeed[];unresolved:UnresolvedNeed[]}{
 if(!input||!Array.isArray(input.occurrences)||!Array.isArray(input.pantry))
  throw Error('Complete canonical plan and Pantry snapshots required.');
 const ids=new Set<string>();
 const needed=new Map<string,{foodId:string;state:string;unit:string;amount:number;occurrenceIds:Set<string>}>();
 const unresolved:UnresolvedNeed[]=[];
 for(const occurrence of input.occurrences){
  if(!occurrence||!identity(occurrence.id)||ids.has(occurrence.id)
   ||!identity(occurrence.sourceId)||!exactDate(occurrence.localDate)
   ||!slots.has(occurrence.mealSlot)||!['food','recipe'].includes(occurrence.kind)
   ||!Number.isSafeInteger(occurrence.servings)||occurrence.servings<=0
   ||!Array.isArray(occurrence.requirements))
   throw Error('Malformed or duplicate planned occurrence.');
  ids.add(occurrence.id);
  const covered=occurrence.preparedCoveredServings??0;
  if(!Number.isSafeInteger(covered)||covered<0||covered>occurrence.servings
   ||(occurrence.kind==='food'&&covered!==0))throw Error('Invalid prepared coverage.');
  const remaining=occurrence.servings-covered;
  if(remaining===0)continue;
  for(const need of occurrence.requirements){
   if(!need||typeof need!=='object')throw Error('Invalid requirement.');
   if('reason' in need){
    if(!reasons.has(need.reason)||(need.foodId!==null&&!identity(need.foodId)))
     throw Error('Invalid unresolved requirement.');
    unresolved.push({occurrenceId:occurrence.id,sourceId:occurrence.sourceId,
     foodId:need.foodId,reason:need.reason});
    continue;
   }
   if(!identity(need.foodId)||!identity(need.preparationState)||!identity(need.unit)
    ||typeof need.perServing!=='number'||!Number.isFinite(need.perServing)||need.perServing<=0)
    throw Error('Reviewed exact ingredient identity, unit, state and quantity required.');
   const amount=need.perServing*remaining;
   if(!Number.isFinite(amount)||amount<=0)throw Error('Invalid scaled amount.');
   const k=key(need.foodId,need.preparationState,need.unit);
   const row=needed.get(k)??{foodId:need.foodId,state:need.preparationState,unit:need.unit,
    amount:0,occurrenceIds:new Set<string>()};
   row.amount+=amount;
   if(!Number.isFinite(row.amount))throw Error('Invalid aggregate quantity.');
   row.occurrenceIds.add(occurrence.id);needed.set(k,row);
  }
 }
 const available=new Map<string,number>();
 for(const lot of input.pantry){
  if(!lot||!identity(lot.foodId)||!identity(lot.preparationState)||!identity(lot.unit)
   ||!nonnegative(lot.onHand)||!nonnegative(lot.reserved)||lot.reserved>lot.onHand)
   throw Error('Invalid Pantry stock or reservation.');
  const k=key(lot.foodId,lot.preparationState,lot.unit);
  const total=(available.get(k)??0)+lot.onHand-lot.reserved;
  if(!Number.isFinite(total))throw Error('Invalid Pantry availability.');
  available.set(k,total);
 }
 const demands=[...needed.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,row])=>{
  const covered=Math.min(row.amount,available.get(k)??0);
  return {foodId:row.foodId,preparationState:row.state,unit:row.unit,
   required:row.amount,available:covered,shortage:Math.max(0,row.amount-covered),
   occurrenceIds:[...row.occurrenceIds].sort()};
 });
 return {demands,shortages:demands.filter(row=>row.shortage>0),
  unresolved:unresolved.sort((a,b)=>a.occurrenceId.localeCompare(b.occurrenceId)||a.reason.localeCompare(b.reason))};
}
