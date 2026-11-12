import type {NativeBillingPlatform,NativeBillingServer} from './nativeBillingFlow.ts';
import {createNativeBillingFlow} from './nativeBillingFlow.ts';
import {createOpenIapStoreAdapter, type OpenIapPort} from './openIapStoreAdapter.ts';

/**
 * ALL-266: staged native runtime boundary. Keep this module safe to import
 * from Expo Go, web, and read-only account screens. The expo-iap module is
 * imported ONLY inside the approved native activation branch.
 *
 * This is not an entitlement writer and does not enable purchases by itself.
 * A separate explicitly approved release integration must pass all gates and
 * wire action handlers; the current billing screen remains read-only.
 */
export type NativeBillingActivation=Readonly<{
  enabled:boolean;
  signedNativeBuild:boolean;
  storeCatalogApproved:boolean;
  serverSecurityApproved:boolean;
}>;

export type NativeBillingRuntime=ReturnType<typeof createNativeBillingFlow>;

export async function prepareNativeBillingRuntime(input:{
  activation:NativeBillingActivation;
  platform:NativeBillingPlatform|'web'|'unknown';
  getAuthenticatedOwner:()=>string|null;
  server:NativeBillingServer&{
    getAccountContext:()=>Promise<{
      ownerId:string;
      ios:{productId:string;appAccountToken:string};
      android:{productId:string;basePlanId:string;obfuscatedAccountId:string};
    }>;
  };
  // Injectable only for no-native Node regression tests. Production loads
  // the already-installed Expo native bridge from the signed client.
  loadNativePort?:()=>Promise<OpenIapPort>;
}):Promise<NativeBillingRuntime|null>{
  const {activation,platform,server,getAuthenticatedOwner}=input;
  if(!activation.enabled||!activation.signedNativeBuild||
     !activation.storeCatalogApproved||!activation.serverSecurityApproved||
     (platform!=='ios'&&platform!=='android'))return null;
  const owner=getAuthenticatedOwner();
  if(!owner||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(owner))
    return null;

  // The backend, never the app bundle, supplies the authoritative product
  // and owner-bound account context. Validate it before touching native IAP.
  const context=await server.getAccountContext();
  if(getAuthenticatedOwner()!==owner||context.ownerId!==owner)return null;
  const productId=platform==='ios'?context.ios.productId:context.android.productId;
  if(!/^[A-Za-z0-9_.-]{3,180}$/.test(productId))return null;
  if(platform==='ios'&&context.ios.appAccountToken.toLowerCase()!==owner.toLowerCase())
    return null;
  if(platform==='android'&&(!context.android.basePlanId||
      !/^[a-f0-9]{64}$/.test(context.android.obfuscatedAccountId)))return null;

  const loadPort=input.loadNativePort??(async()=>{
    const native=await import('./expoIapNativePort.ts');
    return native.createExpoIapNativePort();
  });
  const api=await loadPort();
  if(getAuthenticatedOwner()!==owner)return null;
  const store=createOpenIapStoreAdapter({
    platform,productId,api,getOwner:getAuthenticatedOwner,
    getAccountContext:server.getAccountContext,
  });
  return createNativeBillingFlow({
    platform,productId,store,server,getAuthenticatedOwner,
  });
}

/** Default-off release policy. Real purchase wiring must not use a loose
 * EXPO_PUBLIC flag or bypass server authorization. */
export const nativeBillingReleaseGate:NativeBillingActivation=Object.freeze({
  enabled:false,
  signedNativeBuild:false,
  storeCatalogApproved:false,
  serverSecurityApproved:false,
});
