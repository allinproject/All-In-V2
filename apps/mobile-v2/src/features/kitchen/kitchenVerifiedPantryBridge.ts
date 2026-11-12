import type {KitchenDemandBridgeInput} from './kitchenPlanDemandBridge.ts';
import {projectOwnedKitchenWeek} from './kitchenPlanDemandBridge.ts';
import type {AvailablePantryLot} from './foodPlanShoppingProjection.ts';

/** ALL-248: complete canonical Pantry owner snapshot accepted by the
 * existing Kitchen projection. This is NOT a second inventory or shopping
 * writer. All stock is read-only; nothing is reserved or deducted here.
 */
export type ReviewedPantryLot={
 id:string;ownerId:string;
 foodId:string;preparationState:string;unit:string;
 kind:'edible'|'supply';
 onHand:number;reserved:number;
 usable:boolean;
 expiry:{status:'known';localDate:string}
       |{status:'not_applicable'}
       |{status:'unknown'};
};
export type CanonicalPantrySnapshot={
 ownerId:string;complete:true;revision:string;
 asOfDate:string;lots:readonly ReviewedPantryLot[];
};
const date=(value:unknown):value is string=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(value+'T00:00:00Z');
 return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
};
const text=(value:unknown):value is string=>
 typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=160;
const amount=(value:unknown):value is number=>
 typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1_000_000_000;

/** Strictly convert an ALL-248 canonical owner snapshot to the pre-existing
 * exact-identity Pantry stock view. A missing / partial / foreign snapshot
 * MUST throw; it never means an empty Pantry.
 *
 * The shopping horizon must cover the entire plan week. When stock may expire
 * before its last planned use, exclude it rather than claiming it is available.
 * This is conservative; later per-occurrence expiry allocation can improve it.
 */
export function reviewedPantryAvailability(
 snapshot:CanonicalPantrySnapshot,ownerId:string,throughDate:string,
):{available:AvailablePantryLot[];excludedLotIds:string[]}{
 if(!snapshot||snapshot.complete!==true||!text(ownerId)
   ||snapshot.ownerId!==ownerId||!text(snapshot.revision)
   ||!date(snapshot.asOfDate)||!date(throughDate)
   ||throughDate<snapshot.asOfDate||!Array.isArray(snapshot.lots))
  throw Error('Complete current owner Pantry evidence required.');
 const ids=new Set<string>();
 const available:AvailablePantryLot[]=[];
 const excludedLotIds:string[]=[];
 for(const lot of snapshot.lots){
  if(!lot||!text(lot.id)||ids.has(lot.id)||lot.ownerId!==ownerId
    ||!text(lot.foodId)||!text(lot.preparationState)||!text(lot.unit)
    ||!['edible','supply'].includes(lot.kind)
    ||!amount(lot.onHand)||!amount(lot.reserved)
    ||lot.reserved>lot.onHand||typeof lot.usable!=='boolean'
    ||!lot.expiry||!['known','not_applicable','unknown'].includes(lot.expiry.status)
    ||(lot.expiry.status==='known'&&!date(lot.expiry.localDate)))
   throw Error('Invalid or foreign canonical Pantry lot.');
  ids.add(lot.id);
  const availableThroughPeriod=lot.usable&&
   (lot.expiry.status==='not_applicable'
    ||(lot.expiry.status==='known'&&lot.expiry.localDate>=throughDate));
  if(!availableThroughPeriod){
   excludedLotIds.push(lot.id);
   continue;
  }
  if(lot.onHand>lot.reserved)available.push({
   foodId:lot.foodId,preparationState:lot.preparationState,
   unit:lot.unit,onHand:lot.onHand,reserved:lot.reserved,
  });
 }
 return {available,excludedLotIds};
}

/** Single read-only bridge to ALL-248's existing plan-to-shopping calculation.
 * No checkout, receipt writer, Pantry decrement, or data-domain duplication.
 */
export function projectVerifiedKitchenWeek(
 input:Omit<KitchenDemandBridgeInput,'pantry'> & {
  pantrySnapshot:CanonicalPantrySnapshot;
 },
){
 const {week,pantrySnapshot,...rest}=input;
 if(!week||week.complete!==true||!date(week.weekStart)||!Array.isArray(week.entries))
  throw Error('Complete Kitchen plan required.');
 const weekEnd=new Date(week.weekStart+'T00:00:00Z');
 weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
 const throughDate=weekEnd.toISOString().slice(0,10);
 if(pantrySnapshot.asOfDate>throughDate)
  throw Error('Pantry snapshot is later than the planned week; cannot reconstruct prior stock.');
 const {available,excludedLotIds}=reviewedPantryAvailability(
  pantrySnapshot,week.ownerId,throughDate,
 );
 const projection=projectOwnedKitchenWeek({...rest,week,pantry:available});
 return {...projection,excludedLotIds};
}
