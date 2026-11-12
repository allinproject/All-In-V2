import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../types/database.types.ts';
import {assertV2SessionOwner} from '../../auth/accessGateClient.ts';

/** Review-only ALL-248 Pantry/Shopping reader. Kept OFF until physical schema,
 * account export/deletion, source FKs, privilege tests and device acceptance.
 */
export const V2_KITCHEN_STOCK_READ_ENABLED =
 process.env.EXPO_PUBLIC_V2_KITCHEN_STOCK_READ_ENABLED === 'true';

export type OwnedKitchenStockLot={
 id:string;foodId:string;preparationState:string;unit:string;
 onHand:number;reserved:number;location:'pantry'|'fridge'|'freezer'|'spices';
 usable:boolean;expiryDate:string|null;version:number;
};
export type OwnedKitchenManualShopping={
 id:string;foodId:string|null;description:string;
 preparationState:string|null;unit:string|null;requestedQuantity:number|null;
 state:'needed'|'in_cart';version:number;
};
export type OwnedKitchenStockSnapshot={
 ownerId:string;complete:true;pantryLots:OwnedKitchenStockLot[];
 manualShopping:OwnedKitchenManualShopping[];
};
export type KitchenStockReadOutcome=
 |{status:'ready';snapshot:OwnedKitchenStockSnapshot}
 |{status:'unavailable'};
export type KitchenStockReadServices={
 authenticateOwner:()=>Promise<void>;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<{
  data:unknown;error:{message?:string;code?:string}|null;
 }>;
};
const uid=(x:unknown):x is string=>typeof x==='string'
 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const text=(x:unknown):x is string=>typeof x==='string'
 && x.length>0&&x.length<=200&&x===x.trim();
const amount=(x:unknown):x is number=>typeof x==='number'
 && Number.isFinite(x)&&x>=0&&x<=1e9;
const date=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)
 && !Number.isNaN(Date.parse(x+'T00:00:00Z'))
 && new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function parseOwnedKitchenStock(value:unknown,owner:string):OwnedKitchenStockSnapshot|null{
 if(!uid(owner)||!value||typeof value!=='object'||Array.isArray(value))return null;
 const x=value as Partial<OwnedKitchenStockSnapshot>;
 if(x.ownerId!==owner||x.complete!==true
   ||!Array.isArray(x.pantryLots)||!Array.isArray(x.manualShopping)
   ||x.pantryLots.length>5000||x.manualShopping.length>5000)return null;
 const lots=new Set<string>(),lines=new Set<string>();
 for(const lot of x.pantryLots){
  if(!lot||!uid(lot.id)||lots.has(lot.id)||!text(lot.foodId)
    ||!text(lot.preparationState)||!text(lot.unit)
    ||!amount(lot.onHand)||!amount(lot.reserved)||lot.reserved>lot.onHand
    ||!['pantry','fridge','freezer','spices'].includes(lot.location)
    ||typeof lot.usable!=='boolean'
    ||(lot.expiryDate!==null&&!date(lot.expiryDate))
    ||!Number.isSafeInteger(lot.version)||lot.version<1)return null;
  lots.add(lot.id);
 }
 for(const line of x.manualShopping){
  if(!line||!uid(line.id)||lines.has(line.id)||!text(line.description)
    ||(line.foodId!==null&&!text(line.foodId))
    ||(line.preparationState!==null&&!text(line.preparationState))
    ||(line.unit!==null&&!text(line.unit))
    ||(line.requestedQuantity!==null&&(!amount(line.requestedQuantity)||line.requestedQuantity===0))
    ||!['needed','in_cart'].includes(line.state)
    ||!Number.isSafeInteger(line.version)||line.version<1
    ||(line.foodId===null&&(line.preparationState!==null||line.unit!==null))
    ||(line.foodId!==null&&(line.preparationState===null||line.unit===null)))
    return null;
  lines.add(line.id);
 }
 return x as OwnedKitchenStockSnapshot;
}
export async function readOwnedKitchenStock(
 services:KitchenStockReadServices,owner:string,
 current:()=>boolean=()=>true,enabled=V2_KITCHEN_STOCK_READ_ENABLED,
):Promise<KitchenStockReadOutcome>{
 if(!enabled||!uid(owner)||!current())return {status:'unavailable'};
 try{
  await services.authenticateOwner();
  if(!current())return {status:'unavailable'};
  const result=await services.rpc('v2_kitchen_read_stock_and_manual_shopping',{
   p_expected_user_id:owner,
  });
  if(result.error||!current())return {status:'unavailable'};
  await services.authenticateOwner();
  if(!current())return {status:'unavailable'};
  const snapshot=parseOwnedKitchenStock(result.data,owner);
  return snapshot?{status:'ready',snapshot}:{status:'unavailable'};
 }catch{return {status:'unavailable'};}
}
export function ownedKitchenStockServices(
 client:SupabaseClient<Database>,ownerId:string,
):KitchenStockReadServices{
 return {
  authenticateOwner:()=>assertV2SessionOwner(client,ownerId),
  rpc:client.rpc.bind(client) as unknown as KitchenStockReadServices['rpc'],
 };
}
