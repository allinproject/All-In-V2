import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../types/database.types.ts';
import {assertV2SessionOwner} from '../../auth/accessGateClient.ts';

/** ALL-248: sole transport for the eventual canonical Kitchen week owner.
 * OFF until the reviewed SQL candidate, source FKs, privacy, RLS, and device
 * acceptance are installed. No parallel local planner or shadow shopping data.
 */
export const V2_KITCHEN_PLAN_ENABLED =
  process.env.EXPO_PUBLIC_V2_KITCHEN_PLAN_ENABLED === 'true';

export type PlannedMealSlot='breakfast'|'lunch'|'dinner'|'snack';
export type PlannedKitchenEntry={
  id:string;eatDate:string;mealSlot:PlannedMealSlot;
  sourceKind:'recipe'|'food'|'prepared_meal';sourceId:string;
  portions:number;
  executionMode:'cook_that_day'|'prep_ahead'|'already_prepared'|'planned_food';
};
export type KitchenWeek={
  ownerId:string;weekStart:string;version:number;complete:true;
  entries:readonly PlannedKitchenEntry[];
};
export type KitchenPlanReadOutcome=
  |{status:'ready';week:KitchenWeek}
  |{status:'unavailable'};
export type KitchenPlanWriteOutcome=
  |{status:'saved';version:number}
  |{status:'disabled'|'invalid'|'unavailable'|'conflict'|'unauthorized'};

type RpcOutcome={data:unknown;error:{message?:string;code?:string}|null;status?:number};
export type KitchenPlanServices={
  authenticateOwner:()=>Promise<void>;
  rpc:(name:string,args:Record<string,unknown>)=>Promise<RpcOutcome>;
};
const uuid=(s:unknown):s is string=>typeof s==='string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const date=(s:unknown):s is string=>{
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
};
function validMonday(s:unknown):s is string{
  return date(s)&&new Date(s+'T00:00:00Z').getUTCDay()===1;
}
function validEntry(e:PlannedKitchenEntry,week:string):boolean{
  if(!e||!uuid(e.id)||!date(e.eatDate)||!['breakfast','lunch','dinner','snack'].includes(e.mealSlot)
    ||!['recipe','food','prepared_meal'].includes(e.sourceKind)
    ||typeof e.sourceId!=='string'||!e.sourceId.trim()||e.sourceId.trim()!==e.sourceId
    ||e.sourceId.length>160||!Number.isFinite(e.portions)||e.portions<=0||e.portions>100
    ||!['cook_that_day','prep_ahead','already_prepared','planned_food'].includes(e.executionMode))
    return false;
  const day=new Date(e.eatDate+'T00:00:00Z').getTime(),start=new Date(week+'T00:00:00Z').getTime();
  if(day<start||day>=start+7*86400000)return false;
  if(e.sourceKind==='recipe'&&e.portions!==1)return false;
  if(e.sourceKind==='food'&&e.executionMode!=='planned_food')return false;
  if(e.sourceKind==='prepared_meal'&&e.executionMode!=='already_prepared')return false;
  return true;
}
export function canonicalKitchenWeek(value:unknown,owner:string,week:string):KitchenWeek|null{
  if(!uuid(owner)||!validMonday(week)||!value||typeof value!=='object')return null;
  const data=value as Partial<KitchenWeek>;
  if(data.ownerId!==owner||data.weekStart!==week||data.complete!==true
    ||!Number.isSafeInteger(data.version)||(data.version as number)<0
    ||!Array.isArray(data.entries)||data.entries.length>150)return null;
  const ids=new Set<string>();
  for(const entry of data.entries){
    if(!validEntry(entry,week)||ids.has(entry.id))return null;
    ids.add(entry.id);
  }
  return data as KitchenWeek;
}
export async function readKitchenWeek(
  service:KitchenPlanServices,owner:string,week:string,
  current:()=>boolean=()=>true,enabled=V2_KITCHEN_PLAN_ENABLED,
):Promise<KitchenPlanReadOutcome>{
  if(!enabled||!uuid(owner)||!validMonday(week)||!current())return {status:'unavailable'};
  try{
    await service.authenticateOwner();
    if(!current())return {status:'unavailable'};
    const result=await service.rpc('v2_kitchen_read_plan_week',{
      p_expected_user_id:owner,p_week_start:week,
    });
    if(result.error||!current())return {status:'unavailable'};
    await service.authenticateOwner();
    if(!current())return {status:'unavailable'};
    const decoded=canonicalKitchenWeek(result.data,owner,week);
    return decoded?{status:'ready',week:decoded}:{status:'unavailable'};
  }catch{return {status:'unavailable'};}
}
export async function writeKitchenWeek(
  service:KitchenPlanServices,owner:string,week:string,version:number,
  actionId:string,entries:readonly PlannedKitchenEntry[],
  current:()=>boolean=()=>true,enabled=V2_KITCHEN_PLAN_ENABLED,
):Promise<KitchenPlanWriteOutcome>{
  if(!enabled)return {status:'disabled'};
  if(!uuid(owner)||!validMonday(week)||!uuid(actionId)
    ||!Number.isSafeInteger(version)||version<0||!Array.isArray(entries)
    ||!canonicalKitchenWeek({ownerId:owner,weekStart:week,version,complete:true,entries},owner,week))
    return {status:'invalid'};
  if(!current())return {status:'unavailable'};
  try{
    await service.authenticateOwner();
    if(!current())return {status:'unavailable'};
    const result=await service.rpc('v2_kitchen_replace_plan_week',{
      p_expected_user_id:owner,p_week_start:week,p_expected_version:version,
      p_action_id:actionId,p_entries:entries,
    });
    if(result.error||result.status===409){
      if(result.status===409||result.error?.code==='40001')return {status:'conflict'};
      if(result.error?.code==='42501')return {status:'unauthorized'};
      return {status:'unavailable'};
    }
    if(!current())return {status:'unavailable'};
    await service.authenticateOwner();
    if(!current())return {status:'unavailable'};
    if(!Number.isSafeInteger(result.data)||(result.data as number)<1)return {status:'unavailable'};
    return {status:'saved',version:result.data as number};
  }catch{return {status:'unavailable'};}
}
export function ownedKitchenPlanServices(client:SupabaseClient<Database>,expectedOwnerId:string):KitchenPlanServices{
  return {
    authenticateOwner:()=>assertV2SessionOwner(client,expectedOwnerId),
    rpc:client.rpc.bind(client) as unknown as KitchenPlanServices['rpc'],
  };
}
