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
export async function readCanonicalFuelDay(
 services:FoodDayReadServices,
 expectedOwnerId:string,
 day:string,
 isCurrent:()=>boolean=()=>true,
):Promise<FuelLogDayEvidence>{
 const unavailable:FuelLogDayEvidence={status:'unavailable'};
 if(!V2_FUEL_DAY_READ_ENABLED||!expectedOwnerId.trim()||!isCurrent())return unavailable;
 try{
  await services.authenticateOwner();
  if(!isCurrent())return unavailable;
  const result=await services.readCompleteDay('v2_food_log_read_complete_day',{
   p_expected_user_id:expectedOwnerId,
   p_local_date:day,
  });
  if(!isCurrent()||result.error||!result.data)return unavailable;
  await services.authenticateOwner();
  if(!isCurrent())return unavailable;
  return foodDayForToday(result.data as CanonicalFuelFoodDay,expectedOwnerId,day);
 }catch{
  // Missing/stale RPC or expired session is NOT evidence of an empty day.
  return unavailable;
 }
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
