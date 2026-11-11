import type {NativeBillingServer,NativePurchaseEvidence} from './nativeBillingFlow.ts';

/**
 * ALL-252 client-side transport to the existing V2 Supabase billing functions.
 * The server independently authenticates the current user and verifies StoreKit
 * signed JWS / Google purchase token. The app sends no owner/price/paid claim.
 * Never store signed receipts, Play purchase tokens, or private payment records.
 */
type Result=Readonly<{data?:unknown;error?:unknown;response?:{status?:number}}>;
export type BillingFunctionsClient=Readonly<{
  invoke:(name:string,options:{method:'GET'|'POST';body?:unknown})=>Promise<Result>;
}>;
const uuid=s=>typeof s==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const product=s=>typeof s==='string'&&/^[A-Za-z0-9_.-]{3,180}$/.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function createNativeBillingServerClient({
  client,getOwner,
}:{
  client:BillingFunctionsClient;
  getOwner:()=>string|null;
}):NativeBillingServer&{getAccountContext:()=>Promise<{
  ownerId:string;
  ios:{productId:string;appAccountToken:string};
  android:{productId:string;basePlanId:string;obfuscatedAccountId:string};
}>}{
  const owner=()=>{const id=getOwner();if(!id||!uuid(id))throw Error('billing_owner_unavailable');return id};
  const changed=id=>getOwner()!==id;
  return Object.freeze({
    async getAccountContext(){
      const id=owner();
      const {data,error}=await client.invoke('v2-native-subscription-verify',{
        method:'GET',
      });
      if(error||changed(id)||!data||data.code!=='native_billing_context'||
         data.ios?.appAccountToken?.toLowerCase()!==id.toLowerCase()||
         !product(data.ios?.productId)||
         !product(data.android?.productId)||
         !product(data.android?.basePlanId)||
         !hash(data.android?.obfuscatedAccountId))
        throw Error('billing_context_unavailable');
      return {ownerId:id,ios:{...data.ios},android:{...data.android}};
    },
    async submitEvidence({ownerId,evidence}:{
      ownerId:string;evidence:NativePurchaseEvidence;
    }):Promise<'verified'|'pending'|'rejected'>{
      const id=owner();
      if(ownerId!==id||changed(id)||!evidence||
         !['ios','android'].includes(evidence.platform))
        return 'rejected';
      const body=evidence.platform==='ios'?
        {platform:'ios',signedTransaction:evidence.signedTransaction}:
        {platform:'android',purchaseToken:evidence.purchaseToken};
      const {data,error}=await client.invoke('v2-native-subscription-verify',{
        method:'POST',body,
      });
      if(changed(id))return 'rejected';
      if(!error&&data?.code==='verified')return 'verified';
      if(data?.code==='acknowledgement_required')return 'pending';
      return 'rejected';
    },
    async readOwnerEntitlement(ownerId:string){
      const id=owner();
      if(ownerId!==id)throw Error('wrong_owner');
      const {data,error}=await client.invoke('v2-billing-entitlement',{
        method:'GET',
      });
      if(error||changed(id)||typeof data?.entitled!=='boolean')
        throw Error('entitlement_unavailable');
      return {entitled:data.entitled};
    },
  });
}
