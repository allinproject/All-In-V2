import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../types/database.types.ts';
import {assertV2SessionOwner} from '../../auth/accessGateClient.ts';
import {foodDayForToday, type CanonicalFuelFoodDay} from './fuelOwnerFoodRead.ts';
import type {FuelLogDayEvidence} from '../today/todayFoodLog.ts';

/**
 * ALL-247: the only mobile transport for the canonical complete-day Food Log RPC.
 * No direct table SELECTs, independent diary, calorie estimates or fake photos.
 * Staging availability is explicitly gated; production keeps the prior
 * 'unavailable' UI until the reviewed owner RPC is installed and enabled.
 */
export const V2_FUEL_DAY_READ_ENABLED =
 process.env.EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED === 'true';

type RpcResult={data:unknown;error:{message:string}|null};
type FuelRpc=(name:string,args:Record<string,string>)=>Promise<RpcResult>;

export type FoodDayReadServices={
 authenticateOwner:()=>Promise<void>;
 readCompleteDay:FuelRpc;
};

/** Small injectable boundary to allow race/error and owner-isolation tests. */
/** The owner-checked raw payload is shared by Today preview and Fuel editing.
 * Both authenticate before and after the RPC, and reject partial days.
 */
export async function readCanonicalFuelPayload(
 services:FoodDayReadServices,expectedOwnerId:string,day:string,
 isCurrent:()=>boolean=()=>true,enabled=V2_FUEL_DAY_READ_ENABLED,
):Promise<CanonicalFuelFoodDay|null>{
 if(!enabled||!expectedOwnerId.trim()||!isCurrent())return null;
 try{
  await services.authenticateOwner();
  if(!isCurrent())return null;
  const result=await services.readCompleteDay('v2_food_log_read_complete_day',{
   p_expected_user_id:expectedOwnerId,p_local_date:day,
  });
  if(!isCurrent()||result.error||!result.data)return null;
  await services.authenticateOwner();
  if(!isCurrent())return null;
  const payload=result.data as CanonicalFuelFoodDay;
  return foodDayForToday(payload,expectedOwnerId,day).status==='ready'
   ? payload:null;
 }catch{return null;}
}
export async function readCanonicalFuelDay(
 services:FoodDayReadServices,expectedOwnerId:string,day:string,
 isCurrent:()=>boolean=()=>true,enabled=V2_FUEL_DAY_READ_ENABLED,
):Promise<FuelLogDayEvidence>{
 const payload=await readCanonicalFuelPayload(
  services,expectedOwnerId,day,isCurrent,enabled,
 );
 return payload?foodDayForToday(payload,expectedOwnerId,day):{status:'unavailable'};
}

/** Authenticated mobile client; generated RPC types follow reviewed migration. */
export async function readOwnedFuelDay(
 client:SupabaseClient<Database>,owner:string,day:string,
 isCurrent:()=>boolean=()=>true,
):Promise<FuelLogDayEvidence>{
 const rpc=client.rpc.bind(client) as unknown as FuelRpc;
 return readCanonicalFuelDay({
  authenticateOwner:()=>assertV2SessionOwner(client,owner),
  readCompleteDay:rpc,
 },owner,day,isCurrent);
}

/** Raw complete-day response for Fuel. The editing layer must separately
 * validate all replacement-specific fields before offering edit actions.
 */
export async function readOwnedFuelDayPayload(
 client:SupabaseClient<Database>,owner:string,day:string,
 isCurrent:()=>boolean=()=>true,
):Promise<CanonicalFuelFoodDay|null>{
 const rpc=client.rpc.bind(client) as unknown as FuelRpc;
 return readCanonicalFuelPayload({
  authenticateOwner:()=>assertV2SessionOwner(client,owner),
  readCompleteDay:rpc,
 },owner,day,isCurrent);
}
