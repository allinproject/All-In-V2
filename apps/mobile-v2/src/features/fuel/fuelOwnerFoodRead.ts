import type {FuelLogDayEvidence, FuelLogEntry} from '../today/todayFoodLog.ts';

/** ALL-247: owner-scoped canonical Food Log -> existing Today read contract.
 * Never introduces a second diary, computes nutrients, or fabricates photos.
 * The trusted upstream reader must exhaust all pages before complete=true.
 */
export type FuelOwnerFoodRow = {
 id: string; user_id: string; consumed_at: string; local_date: string;
 meal_slot: string; label: string; created_at: string; deleted_at: string | null;
 revision: number;
};
export type CanonicalFuelFoodDay = {
 ownerId: string; localDate: string; sourceRevision: string;
 complete: boolean; entries: readonly FuelOwnerFoodRow[];
};
const validDay=(v:unknown):v is string=>{
 if (typeof v!=='string'|| !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
 const d=new Date(v+'T00:00:00Z');
 return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;
};
const meals=new Set(['breakfast','lunch','dinner','snack','other']);
const text=(v:unknown,max=160):v is string=>
 typeof v==='string'&&v.trim().length>0&&v.length<=max;
const timestamp=(v:unknown):v is string=>
 typeof v==='string'&&Number.isFinite(Date.parse(v));

/** Reject the ENTIRE returned day if a row is off-account, off-day, deleted,
 * duplicated, malformed or the upstream page coverage is unproven.
 */
export function foodDayForToday(
 response: CanonicalFuelFoodDay|null, ownerId:string, day:string,
):FuelLogDayEvidence {
 if (!response||!text(ownerId,100)||!validDay(day)
   ||response.ownerId!==ownerId||response.localDate!==day
   ||response.complete!==true||!text(response.sourceRevision,160)
   ||!Array.isArray(response.entries)) return {status:'unavailable'};
 const ids=new Set<string>();const entries:FuelLogEntry[]=[];
 for(const e of response.entries) {
  if(!e||!text(e.id,100)||ids.has(e.id)||e.user_id!==ownerId
     ||e.local_date!==day||e.deleted_at!==null
     ||!timestamp(e.consumed_at)||!timestamp(e.created_at)
     ||!text(e.label)||!meals.has(e.meal_slot)
     ||!Number.isSafeInteger(e.revision)||e.revision<1)
    return {status:'unavailable'};
  ids.add(e.id);
  entries.push({id:e.id,ownerId,athleteLocalDate:day,label:e.label,
    meal:e.meal_slot as FuelLogEntry['meal'],createdAt:e.created_at,photo:null});
 }
 return {status:'ready',ownerId,athleteLocalDate:day,
    sourceRevision:response.sourceRevision,entries};
}
