import type {ProjectedNeed,UnresolvedNeed} from './foodPlanShoppingProjection.ts';

export type VerifiedShoppingManual={
 id:string;ownerId:string;description:string;
 foodId:string|null;preparationState:string|null;unit:string|null;
 requestedQuantity:number|null;state:'needed'|'in_cart';
 version:number;
};
export type VerifiedManualShoppingSnapshot={
 ownerId:string;complete:true;revision:string;
 lines:readonly VerifiedShoppingManual[];
};
export type ShoppingNeedRow={
 foodId:string;preparationState:string;unit:string;
 quantity:number;state:'needed'|'in_cart';
 plannedOccurrenceIds:string[];manualLineIds:string[];
};
const exact=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200&&v.trim()===v;
const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=1e9;
const key=(id:string,state:string,unit:string,cart:string)=>JSON.stringify([id,state,unit,cart]);
/** Combines projections for display only. Source rows remain authoritative:
 * changing Meal Plan MUST NOT edit manual Shopping records.
 */
export function composeKitchenShoppingView(input:{
 ownerId:string;manual:VerifiedManualShoppingSnapshot;
 plannedShortages:readonly ProjectedNeed[];
 unresolvedPlan:readonly UnresolvedNeed[];
}):{rows:ShoppingNeedRow[];unresolvedManual:VerifiedShoppingManual[];
 unresolvedPlan:UnresolvedNeed[]}{
 if(!input||!exact(input.ownerId)||!input.manual||input.manual.complete!==true
   ||input.manual.ownerId!==input.ownerId||!exact(input.manual.revision)
   ||!Array.isArray(input.manual.lines)||!Array.isArray(input.plannedShortages)
   ||!Array.isArray(input.unresolvedPlan))
  throw Error('Complete current Shopping evidence required.');
 const rows=new Map<string,ShoppingNeedRow>();
 const manualIds=new Set<string>();
 const unresolvedManual:VerifiedShoppingManual[]=[];
 const add=(foodId:string,state:string,unit:string,cart:'needed'|'in_cart',
  quantity:number,origins:string[],manualIdsForRow:string[])=>{
  const k=key(foodId,state,unit,cart);
  const r=rows.get(k)??{foodId,preparationState:state,unit,
    quantity:0,state:cart,plannedOccurrenceIds:[],manualLineIds:[]};
  r.quantity+=quantity;
  if(!Number.isFinite(r.quantity)||r.quantity>1e10)
   throw Error('Shopping quantity cannot be represented.');
  r.plannedOccurrenceIds.push(...origins);
  r.manualLineIds.push(...manualIdsForRow);
  rows.set(k,r);
 };
 for(const planned of input.plannedShortages){
  if(!planned||!exact(planned.foodId)||!exact(planned.preparationState)
    ||!exact(planned.unit)||!positive(planned.shortage)
    ||!Array.isArray(planned.occurrenceIds)
    ||planned.occurrenceIds.length===0
    ||planned.occurrenceIds.some((id:string)=>!exact(id))
    ||new Set(planned.occurrenceIds).size!==planned.occurrenceIds.length)
   throw Error('Incomplete planned Shopping shortage.');
  add(planned.foodId,planned.preparationState,planned.unit,'needed',
   planned.shortage,planned.occurrenceIds,[]);
 }
 for(const manual of input.manual.lines){
  if(!manual||!exact(manual.id)||manualIds.has(manual.id)
    ||manual.ownerId!==input.ownerId||!exact(manual.description)
    ||!['needed','in_cart'].includes(manual.state)
    ||!Number.isSafeInteger(manual.version)||manual.version<1
    ||(manual.foodId!==null&&!exact(manual.foodId))
    ||(manual.preparationState!==null&&!exact(manual.preparationState))
    ||(manual.unit!==null&&!exact(manual.unit))
    ||(manual.requestedQuantity!==null&&!positive(manual.requestedQuantity)))
   throw Error('Invalid or foreign manual Shopping line.');
  manualIds.add(manual.id);
  if(!manual.foodId||!manual.preparationState||!manual.unit
    ||manual.requestedQuantity===null){
   unresolvedManual.push(manual);continue;
  }
  add(manual.foodId,manual.preparationState,manual.unit,manual.state,
   manual.requestedQuantity,[],[manual.id]);
 }
 for(const row of rows.values()){
  row.plannedOccurrenceIds=[...new Set(row.plannedOccurrenceIds)].sort();
  row.manualLineIds.sort();
 }
 return {rows:[...rows.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v),
  unresolvedManual,unresolvedPlan:input.unresolvedPlan};
}
