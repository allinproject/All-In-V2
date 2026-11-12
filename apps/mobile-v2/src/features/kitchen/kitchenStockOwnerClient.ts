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
export const V2_KITCHEN_MANUAL_SHOPPING_WRITE_ENABLED =
 process.env.EXPO_PUBLIC_V2_KITCHEN_MANUAL_SHOPPING_WRITE_ENABLED === 'true';
export const V2_KITCHEN_PURCHASE_CONFIRM_ENABLED =
 process.env.EXPO_PUBLIC_V2_KITCHEN_PURCHASE_CONFIRM_ENABLED === 'true';
export type ManualShoppingWrite={
 lineId:string;expectedVersion:number;actionId:string;
 description:string;foodId:string|null;
 preparationState:string|null;unit:string|null;quantity:number|null;
 state:'needed'|'in_cart'|'archived';
};
export type PurchaseConfirmationLine={
 lineId:string;lotId:string;foodId:string;preparationState:string;unit:string;
 stockLocation:'pantry'|'fridge'|'freezer'|'spices';
 quantity:number;expectedLotVersion:number;expiryDate:string|null;
};
export type KitchenStockWriteResult=
 |{status:'saved';version?:number;receiptId?:string}
 |{status:'disabled'|'invalid'|'unavailable'|'conflict'|'unauthorized'};
const allowedStockLocation=(v:unknown)=>['pantry','fridge','freezer','spices'].includes(String(v));
const resultStatus=(error:{code?:string}|null,code?:number):KitchenStockWriteResult=>{
 if(code===409||error?.code==='40001')return {status:'conflict'};
 if(error?.code==='42501')return {status:'unauthorized'};
 return {status:'unavailable'};
};
export async function writeOwnedManualShopping(
 services:KitchenStockReadServices,owner:string,entry:ManualShoppingWrite,
 current:()=>boolean=()=>true,enabled=V2_KITCHEN_MANUAL_SHOPPING_WRITE_ENABLED,
):Promise<KitchenStockWriteResult>{
 if(!enabled)return {status:'disabled'};
 if(!uid(owner)||!entry||!uid(entry.lineId)||!uid(entry.actionId)
  ||!Number.isSafeInteger(entry.expectedVersion)||entry.expectedVersion<0
  ||!text(entry.description)||!['needed','in_cart','archived'].includes(entry.state)
  ||(entry.foodId===null&&(entry.preparationState!==null||entry.unit!==null))
  ||(entry.foodId!==null&&(!text(entry.foodId)||!text(entry.preparationState)||!text(entry.unit)))
  ||(entry.quantity!==null&&(!amount(entry.quantity)||entry.quantity===0)))
  return {status:'invalid'};
 if(!current())return {status:'unavailable'};
 try{
  await services.authenticateOwner();
  if(!current())return {status:'unavailable'};
  const res=await services.rpc('v2_kitchen_write_manual_shopping',{
   p_expected_user_id:owner,p_line_id:entry.lineId,
   p_expected_version:entry.expectedVersion,p_action_id:entry.actionId,
   p_description:entry.description,p_food_source_id:entry.foodId,
   p_preparation_state:entry.preparationState,p_unit:entry.unit,
   p_quantity:entry.quantity,p_state:entry.state,
  });
  if(res.error)return resultStatus(res.error);
  await services.authenticateOwner();
  if(!current()||!Number.isSafeInteger(res.data)||(res.data as number)<1)
   return {status:'unavailable'};
  return {status:'saved',version:res.data as number};
 }catch{return {status:'unavailable'};}
}
export async function confirmOwnedKitchenPurchase(
 services:KitchenStockReadServices,owner:string,receiptId:string,
 actionId:string,lines:readonly PurchaseConfirmationLine[],
 current:()=>boolean=()=>true,enabled=V2_KITCHEN_PURCHASE_CONFIRM_ENABLED,
):Promise<KitchenStockWriteResult>{
 if(!enabled)return {status:'disabled'};
 if(!uid(owner)||!uid(receiptId)||!uid(actionId)||!Array.isArray(lines)
  ||lines.length<1||lines.length>100)return {status:'invalid'};
 const lotIds=new Set<string>(),lineIds=new Set<string>();
 for(const line of lines){
  if(!line||!uid(line.lineId)||lineIds.has(line.lineId)
   ||!uid(line.lotId)||lotIds.has(line.lotId)
   ||!text(line.foodId)||!text(line.preparationState)||!text(line.unit)
   ||!allowedStockLocation(line.stockLocation)
   ||!amount(line.quantity)||line.quantity===0
   ||!Number.isSafeInteger(line.expectedLotVersion)||line.expectedLotVersion<0
   ||(line.expiryDate!==null&&!date(line.expiryDate)))return {status:'invalid'};
  lotIds.add(line.lotId);lineIds.add(line.lineId);
 }
 if(!current())return {status:'unavailable'};
 try{
  await services.authenticateOwner();
  if(!current())return {status:'unavailable'};
  const res=await services.rpc('v2_kitchen_confirm_purchase',{
   p_expected_user_id:owner,p_receipt_id:receiptId,
   p_action_id:actionId,p_lines:lines,
  });
  if(res.error)return resultStatus(res.error);
  await services.authenticateOwner();
  if(!current()||res.data!==receiptId)return {status:'unavailable'};
  return {status:'saved',receiptId};
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
