import type {NativeStoreAdapter,NativeBillingPlatform,NativePurchaseEvidence} from './nativeBillingFlow.ts';

/**
 * ALL-252: Expo-IAP / OpenIAP event transport without importing native code
 * into Node/Expo Go. Production caller injects the pinned expo-iap methods
 * from a DEV BUILD only. Native store results never grant paid access.
 */
export type OpenIapPurchase=Readonly<{
  productId:string;
  store?:'apple'|'google'|string;
  purchaseToken?:string|null;
  purchaseState?:string|number|null;
}>;
export type OpenIapProduct=Readonly<{
  id:string;
  subscriptionOffers?:readonly {basePlanIdAndroid?:string|null;
    offerTokenAndroid?:string|null}[];
}>;
type Listener={remove:()=>void};
export type OpenIapPort=Readonly<{
  initConnection:()=>Promise<boolean>;
  fetchProducts:(query:{skus:string[];type:'subs'})=>Promise<readonly OpenIapProduct[]>;
  requestPurchase:(request:unknown)=>Promise<unknown>;
  purchaseUpdatedListener:(callback:(purchase:OpenIapPurchase)=>void)=>Listener;
  purchaseErrorListener:(callback:(error:{code?:string})=>void)=>Listener;
  getAvailablePurchases:(options?:{onlyIncludeActiveItemsIOS?:boolean})=>
    Promise<readonly OpenIapPurchase[]>;
  finishTransaction:(request:{purchase:OpenIapPurchase;isConsumable:false})=>Promise<void>;
}>;
type Context=Readonly<{
  ownerId:string;
  ios?:{productId:string;appAccountToken:string};
  android?:{productId:string;basePlanId:string;obfuscatedAccountId:string};
}>;
const uuid=(v:string)=>typeof v==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hex64=(v:string)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const evidenceKey=(e:NativePurchaseEvidence)=>e.platform+':'+
  (e.platform==='ios'?e.signedTransaction:e.purchaseToken);
const acquired=(purchase:OpenIapPurchase,platform:NativeBillingPlatform)=>
  (purchase.store==null||
    purchase.store===(platform==='ios'?'apple':'google'))&&
  (platform==='ios'||
    purchase.purchaseState==null||
    purchase.purchaseState==='purchased'||purchase.purchaseState===1);
export function createOpenIapStoreAdapter({
  platform,productId,api,getOwner,getAccountContext,timeoutMs=120000,
}:{
  platform:NativeBillingPlatform;
  productId:string;
  api:OpenIapPort;
  getOwner:()=>string|null;
  getAccountContext:()=>Promise<Context>;
  timeoutMs?:number;
}):NativeStoreAdapter&{finishVerifiedPurchase:(e:NativePurchaseEvidence)=>Promise<void>} {
  let connected=false,products:readonly OpenIapProduct[]=[];
  const unfinished=new Map<string,OpenIapPurchase>();
  const connect=async()=>{
    if(!connected)connected=await api.initConnection();
    if(!connected)throw Error('native_store_not_ready');
  };
  const normalize=(p:OpenIapPurchase):NativePurchaseEvidence|null=>{
    if(!p||p.productId!==productId||!acquired(p,platform)||
      typeof p.purchaseToken!=='string'||!p.purchaseToken)
      return null;
    const evidence=platform==='ios'?
      {platform,productId,signedTransaction:p.purchaseToken} as const:
      {platform,productId,purchaseToken:p.purchaseToken} as const;
    unfinished.set(evidenceKey(evidence),p);
    return evidence;
  };
  const checkedContext=async()=>{
    const owner=getOwner();
    if(!owner||!uuid(owner))throw Error('owner_unavailable');
    const context=await getAccountContext();
    if(context.ownerId!==owner||getOwner()!==owner)
      throw Error('owner_changed');
    if(platform==='ios'){
      if(context.ios?.productId!==productId||
        context.ios.appAccountToken.toLowerCase()!==owner.toLowerCase())
        throw Error('apple_owner_binding_unavailable');
    }else if(context.android?.productId!==productId||
      !context.android.basePlanId||!hex64(context.android.obfuscatedAccountId))
      throw Error('google_owner_binding_unavailable');
    return context;
  };
  return {
    platform,
    async getProducts(ids){
      if(ids.length!==1||ids[0]!==productId)
        throw Error('unapproved_native_sku');
      await connect();
      const found=await api.fetchProducts({skus:[productId],type:'subs'});
      products=found.filter(p=>p.id===productId);
      return products.map(p=>({id:p.id}));
    },
    async purchase(id){
      if(id!==productId)throw Error('unapproved_native_sku');
      await connect();
      const context=await checkedContext();
      if(!products.length)await this.getProducts([id]);
      // Product discovery may outlive the originating account session.
      // Never open a store purchase with a stale appAccountToken/owner hash.
      if(getOwner()!==context.ownerId)throw Error('owner_changed');
      let request:unknown;
      if(platform==='ios'){
        request={type:'subs',request:{apple:{
          sku:productId,appAccountToken:context.ios!.appAccountToken,
        }}};
      }else{
        const matching=products.flatMap(p=>p.subscriptionOffers??[]).filter(o=>
          o.basePlanIdAndroid===context.android!.basePlanId&&
          typeof o.offerTokenAndroid==='string'&&o.offerTokenAndroid.length>0);
        if(matching.length!==1)throw Error('google_offer_ambiguous');
        request={type:'subs',request:{google:{
          skus:[productId],
          subscriptionOffers:[{sku:productId,offerToken:matching[0].offerTokenAndroid}],
          obfuscatedAccountId:context.android!.obfuscatedAccountId,
        }}};
      }
      return await new Promise<NativePurchaseEvidence|null>((resolve,reject)=>{
        let finished=false;
        let success:Listener|undefined,error:Listener|undefined;
        const complete=(v:NativePurchaseEvidence|null,reason?:Error)=>{
          if(finished)return;
          finished=true;clearTimeout(timer);
          success?.remove();error?.remove();
          if(reason)reject(reason);else resolve(v);
        };
        const timer=setTimeout(()=>complete(null,Error('native_purchase_timeout')),timeoutMs);
        try{
          success=api.purchaseUpdatedListener(p=>{
            if(getOwner()!==context.ownerId){
              complete(null,Error('owner_changed'));
              return;
            }
            const result=normalize(p);
            if(result)complete(result);
          });
          error=api.purchaseErrorListener(err=>{
            if(err?.code==='user-cancelled'||err?.code==='E_USER_CANCELLED')
              complete(null);
            else complete(null,Error('native_purchase_failed'));
          });
          void api.requestPurchase(request).catch(()=>
            complete(null,Error('native_purchase_launch_failed')));
        }catch{complete(null,Error('native_purchase_listener_failed'))}
      });
    },
    async restore(){
      await connect();
      await checkedContext();
      const purchases=await api.getAvailablePurchases(
        platform==='ios'?{onlyIncludeActiveItemsIOS:false}:undefined);
      const evidence:NativePurchaseEvidence[]=[];
      for(const p of purchases){
        const normalized=normalize(p);
        if(normalized)evidence.push(normalized);
      }
      return evidence;
    },
    async finishVerifiedPurchase(e){
      const key=evidenceKey(e),purchase=unfinished.get(key);
      if(!purchase)throw Error('native_transaction_not_found');
      await api.finishTransaction({purchase,isConsumable:false});
      unfinished.delete(key);
    },
  };
}
