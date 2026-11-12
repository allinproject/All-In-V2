import type {KitchenWeek,PlannedKitchenEntry} from './kitchenPlanOwnerClient.ts';
import {projectFoodPlanShopping,type ExactNeed,type UnknownNeed,
 type AvailablePantryLot,type PlannedKitchenOccurrence} from './foodPlanShoppingProjection.ts';

export type ReviewedKitchenSource={
 ownerId:string;sourceKind:'recipe'|'food';sourceId:string;complete:true;
 requirements:readonly (ExactNeed|UnknownNeed)[];
};
export type KitchenDemandBridgeInput={
 week:KitchenWeek;
 sources:readonly ReviewedKitchenSource[];
 pantry:readonly AvailablePantryLot[];
 /** Counts already cooked for exact recipe plan occurrences, never guesses. */
 preparedCoverage:Readonly<Record<string,number>>;
 /** Prepared-meal entries require a separate confirmed stock snapshot. */
 confirmedPreparedEntryIds:readonly string[];
};
/** Reconciles ONLY fully verified, same-owner kitchen source requirements.
 * The canonical plan remains the only schedule; this creates no Shopping rows.
 */
export function projectOwnedKitchenWeek(input:KitchenDemandBridgeInput){
 if(!input||!input.week||input.week.complete!==true
  ||!Array.isArray(input.week.entries)||!Array.isArray(input.sources)
  ||!Array.isArray(input.pantry)||!Array.isArray(input.confirmedPreparedEntryIds)
  ||!input.preparedCoverage||typeof input.preparedCoverage!=='object')
   throw Error('Complete owner-scoped Kitchen source and Pantry snapshots required.');
 const {week}=input;
 const sourceMap=new Map<string,ReviewedKitchenSource>();
 for(const item of input.sources){
  if(!item||item.complete!==true||item.ownerId!==week.ownerId
   ||!['recipe','food'].includes(item.sourceKind)
   ||typeof item.sourceId!=='string'||!item.sourceId
   ||!Array.isArray(item.requirements)||!item.requirements.length)
    throw Error('Unverified Kitchen ingredient or food source.');
  const key=JSON.stringify([item.sourceKind,item.sourceId]);
  if(sourceMap.has(key))throw Error('Duplicate canonical Kitchen source snapshot.');
  sourceMap.set(key,item);
 }
 const knownPrepared=new Set(input.confirmedPreparedEntryIds);
 if(knownPrepared.size!==input.confirmedPreparedEntryIds.length)
  throw Error('Duplicate prepared stock coverage identity.');
 const entries=new Set(week.entries.map(e=>e.id));
 for(const id of knownPrepared)if(!entries.has(id))throw Error('Foreign prepared stock coverage.');
 for(const id of Object.keys(input.preparedCoverage))if(!entries.has(id))
  throw Error('Foreign recipe prepared coverage.');
 const occurrences:PlannedKitchenOccurrence[]=[];
 const pendingPrepared:string[]=[];
 for(const entry of week.entries){
  if(entry.sourceKind==='prepared_meal'){
   if(!knownPrepared.has(entry.id))pendingPrepared.push(entry.id);
   continue;
  }
  const ref=sourceMap.get(JSON.stringify([entry.sourceKind,entry.sourceId]));
  const requirements=ref?.requirements??[{foodId:null,reason:'unknown_identity'} as const];
  const prepared=entry.sourceKind==='recipe'?(input.preparedCoverage[entry.id]??0):0;
  if(!Number.isFinite(prepared)||prepared<0||prepared>entry.portions
   ||(entry.sourceKind==='recipe'&&!Number.isSafeInteger(prepared)))
    throw Error('Unverified prepared recipe quantity.');
  occurrences.push({
   id:entry.id,localDate:entry.eatDate,mealSlot:entry.mealSlot,
   kind:entry.sourceKind,sourceId:entry.sourceId,servings:entry.portions,
   preparedCoveredServings:prepared,requirements,
  });
 }
 const projection=projectFoodPlanShopping({occurrences,pantry:input.pantry});
 return {...projection,pendingPrepared};
}
