import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../types/database.types.ts';
import {assertV2SessionOwner} from '../../auth/accessGateClient.ts';

/** ALL-247 mobile transport for the existing one-owner Food Log RPCs.
 * Feature is OFF until permanent schema, device and privacy acceptance.
 * Caller owns stable UUIDs: never regenerate an action ID during a retry.
 */
export const V2_FUEL_MANUAL_WRITE_ENABLED =
 process.env.EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED === 'true';

export type ManualFoodReplacement = {
 consumedAt: string; localDate: string; timezoneName: string;
 mealSlot: 'breakfast'|'lunch'|'dinner'|'snack'|'other';
 label: string; quantity: number; unit: 'g'|'ml'|'oz'|'fl_oz'|'serving'|'each';
 kcal: number|null; nutritionSource: 'user_entered'|'unknown';
};
export type ManualFoodCommand =
 | {operation:'add'; ownerId:string; actionId:string; entryId:string; replacement:ManualFoodReplacement}
 | {operation:'edit'|'move'; ownerId:string; actionId:string; entryId:string; expectedRevision:number; replacement:ManualFoodReplacement}
 | {operation:'delete'; ownerId:string; actionId:string; entryId:string; expectedRevision:number};
export type FoodWriteOutcome =
 | {status:'saved'; entryId:string; revision:number; replayed:boolean}
 | {status:'disabled'|'invalid'|'unauthorized'|'unavailable'|'conflict'};
type FoodRpcResult={data:unknown; error:{code?:string;message?:string}|null;status?:number};
export type FoodWriteServices={
 authenticateOwner:()=>Promise<void>;
 mutate:(name:string,args:Record<string,unknown>)=>Promise<FoodRpcResult>;
};
const uuid=(v:unknown):v is string=>
 typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const date=(v:unknown):v is string=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const x=new Date(v+'T00:00:00Z');
 return Number.isFinite(x.valueOf())&&x.toISOString().slice(0,10)===v;
};
const slots=new Set(['breakfast','lunch','dinner','snack','other']);
const units=new Set(['g','ml','oz','fl_oz','serving','each']);
function validReplacement(r:ManualFoodReplacement):boolean {
 if(!r||!date(r.localDate)||!Number.isFinite(Date.parse(r.consumedAt))
   ||!r.timezoneName||r.timezoneName.length>80
   ||!slots.has(r.mealSlot)||typeof r.label!=='string'
   ||!r.label.trim()||r.label.length>200||!units.has(r.unit)
   ||!Number.isFinite(r.quantity)||r.quantity<=0||r.quantity>1000000) return false;
 if(r.nutritionSource==='unknown') return r.kcal===null;
 return r.nutritionSource==='user_entered' && r.kcal!==null
    &&Number.isFinite(r.kcal)&&r.kcal>=0;
}
function validCommand(c:ManualFoodCommand):boolean{
 if(!c||!uuid(c.ownerId)||!uuid(c.entryId)||!uuid(c.actionId))return false;
 if(c.operation==='add')return validReplacement(c.replacement);
 if(!Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<1)return false;
 return c.operation==='delete'||((c.operation==='edit'||c.operation==='move')&&validReplacement(c.replacement));
}
function args(c:ManualFoodCommand):Record<string,unknown>{
 const base:Record<string,unknown>={
  p_expected_user_id:c.ownerId,p_action_id:c.actionId,p_entry_id:c.entryId,
 };
 if(c.operation!=='add'){
  base.p_expected_revision=c.expectedRevision;
  base.p_operation=c.operation;
 }
 if(c.operation==='delete')return base;
 const r=c.replacement;
 return {...base,p_consumed_at:r.consumedAt,p_local_date:r.localDate,
  p_timezone_name:r.timezoneName,p_meal_slot:r.mealSlot,p_label:r.label,
  p_quantity:r.quantity,p_unit:r.unit,p_kcal:r.kcal,
  p_nutrition_source:r.nutritionSource};
}
/** No client-side retry of a revision conflict. Refetch and have the user
 * resolve it; automatic retry would overwrite another device's newer work.
 * isCurrent also prevents stale UI/session responses being accepted.
 */
export async function writeManualFood(
 services:FoodWriteServices,c:ManualFoodCommand,
 isCurrent:()=>boolean=()=>true,enabled=V2_FUEL_MANUAL_WRITE_ENABLED,
):Promise<FoodWriteOutcome>{
 if(!enabled)return {status:'disabled'};
 if(!validCommand(c)||!isCurrent())return {status:'invalid'};
 try{await services.authenticateOwner();}
 catch{return {status:'unauthorized'};}
 if(!isCurrent())return {status:'unavailable'};
 let result:FoodRpcResult;
 try{result=await services.mutate(
   c.operation==='add'?'v2_food_log_add_manual':'v2_food_log_mutate_manual',args(c),
  );}
 catch{return {status:'unavailable'};}
 if(!isCurrent())return {status:'unavailable'};
 if(result.error){
  if(result.status===409||result.error.code==='PT409')return {status:'conflict'};
  if(result.status===401||result.status===403)return {status:'unauthorized'};
  return {status:'unavailable'};
 }
 try{await services.authenticateOwner();}
 catch{return {status:'unauthorized'};}
 if(!isCurrent())return {status:'unavailable'};
 const d=result.data as {id?:unknown;revision?:unknown;replayed?:unknown}|null;
 if(!d||d.id!==c.entryId||!Number.isSafeInteger(d.revision)
   ||(d.revision as number)<1||typeof d.replayed!=='boolean')return {status:'unavailable'};
 return {status:'saved',entryId:c.entryId,revision:d.revision as number,replayed:d.replayed};
}
export async function writeOwnedManualFood(
 client:SupabaseClient<Database>,command:ManualFoodCommand,
 isCurrent:()=>boolean=()=>true,
):Promise<FoodWriteOutcome>{
 return writeManualFood({
  authenticateOwner:()=>assertV2SessionOwner(client,command.ownerId),
  mutate:client.rpc.bind(client) as unknown as FoodWriteServices['mutate'],
 },command,isCurrent);
}
