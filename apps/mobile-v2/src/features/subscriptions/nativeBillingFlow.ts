/**
 * ALL-252 native purchase and restore orchestration. Source-only until the
 * approved StoreKit 2 / Google Play Billing native module is integrated.
 * NEVER use Stripe web checkout for in-app digital subscriptions.
 *
 * The injected nativeStore must be a real platform purchase adapter; the
 * server endpoint independently verifies signed Apple transactions or
 * Google purchase tokens and binds the immutable provider purchase to owner.
 * A local purchase result NEVER grants access.
 */
export type NativeBillingPlatform='ios'|'android';
export type NativePurchaseEvidence=Readonly<{
  platform:NativeBillingPlatform;
  productId:string;
  signedTransaction?:string;
  purchaseToken?:string;
}>;
export type NativeBillingOutcome=
  |'server_entitled'|'not_entitled'|'purchase_pending'|'canceled'
  |'unsupported'|'needs_setup'|'verification_unavailable'|'wrong_account';

export type NativeStoreAdapter=Readonly<{
  platform:NativeBillingPlatform;
  getProducts:(ids:readonly string[])=>Promise<readonly {id:string}[]>;
  purchase:(productId:string)=>Promise<NativePurchaseEvidence|null>;
  restore:()=>Promise<readonly NativePurchaseEvidence[]>;
}>;

export type NativeBillingServer=Readonly<{
  submitEvidence:(input:{ownerId:string;evidence:NativePurchaseEvidence})=>
    Promise<'verified'|'pending'|'rejected'>;
  readOwnerEntitlement:(ownerId:string)=>Promise<{entitled:boolean}>;
}>;

const uuid=(v:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const product=(v:string)=>typeof v==='string'&&/^[A-Za-z0-9_.-]{3,180}$/.test(v);

export function createNativeBillingFlow(input:{
  platform:NativeBillingPlatform;
  productId:string|undefined;
  store:NativeStoreAdapter|null;
  server:NativeBillingServer;
  getAuthenticatedOwner:()=>string|null;
}){
  let busy=false;
  async function reconcile(owner:string,evidence:NativePurchaseEvidence):
    Promise<NativeBillingOutcome>{
    if(!evidence||evidence.platform!==input.platform||
       evidence.productId!==input.productId||
       (input.platform==='ios'?!evidence.signedTransaction||!!evidence.purchaseToken:
        !evidence.purchaseToken||!!evidence.signedTransaction))
      return 'verification_unavailable';
    try{
      const result=await input.server.submitEvidence({ownerId:owner,evidence});
      if(input.getAuthenticatedOwner()!==owner)return 'wrong_account';
      if(result==='pending')return 'purchase_pending';
      if(result!=='verified')return 'verification_unavailable';
      const read=await input.server.readOwnerEntitlement(owner);
      if(input.getAuthenticatedOwner()!==owner)return 'wrong_account';
      return read?.entitled===true?'server_entitled':'not_entitled';
    }catch{return 'verification_unavailable'}
  }
  const ready=()=>!!input.store&&input.store.platform===input.platform&&
    product(input.productId??'')&&typeof input.getAuthenticatedOwner==='function';
  return Object.freeze({
    async purchase():Promise<NativeBillingOutcome>{
      if(busy)return 'purchase_pending';
      if(!ready())return 'needs_setup';
      const owner=input.getAuthenticatedOwner();
      if(!owner||!uuid(owner))return 'wrong_account';
      busy=true;
      try{
        const products=await input.store!.getProducts([input.productId!]);
        if(!products.some(p=>p.id===input.productId))return 'needs_setup';
        if(input.getAuthenticatedOwner()!==owner)return 'wrong_account';
        const evidence=await input.store!.purchase(input.productId!);
        if(!evidence)return 'canceled';
        if(input.getAuthenticatedOwner()!==owner)return 'wrong_account';
        return await reconcile(owner,evidence);
      }catch{return 'verification_unavailable'}
      finally{busy=false}
    },
    async restore():Promise<NativeBillingOutcome>{
      if(busy)return 'purchase_pending';
      if(!ready())return 'needs_setup';
      const owner=input.getAuthenticatedOwner();
      if(!owner||!uuid(owner))return 'wrong_account';
      busy=true;
      try{
        const receipts=await input.store!.restore();
        if(input.getAuthenticatedOwner()!==owner)return 'wrong_account';
        const evidence=receipts.filter(p=>p.platform===input.platform&&
          p.productId===input.productId);
        if(evidence.length===0){
          const read=await input.server.readOwnerEntitlement(owner);
          return input.getAuthenticatedOwner()===owner&&read?.entitled===true?
            'server_entitled':'not_entitled';
        }
        for(const receipt of evidence){
          const outcome=await reconcile(owner,receipt);
          if(outcome==='server_entitled'||outcome==='wrong_account')return outcome;
        }
        return 'verification_unavailable';
      }catch{return 'verification_unavailable'}
      finally{busy=false}
    },
  });
}
