// ALL-252 — STAGED native subscription verification (iOS + Android).
// NEVER deploy/arm before ALL-222 schema/security approval, trusted store
// configuration and on-device StoreKit/Google Play purchase acceptance.
// No Stripe native checkout, user-provided owner, raw token persistence or
// client-derived entitlement. All store credentials remain server-only.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { Buffer } from "node:buffer";
import { AppStoreServerAPIClient, SignedDataVerifier, Environment } from
  "npm:@apple/app-store-server-library@3.1.0";
import { createAppleStoreServerAdapters } from "../_shared/appleStoreServerAdapters.mjs";
import { createGoogleServiceAccountAccessToken } from "../_shared/googleServiceAccountAccessToken.mjs";
import { createGooglePlayDeveloperTransport } from "../_shared/googlePlayDeveloperTransport.mjs";
import { obfuscatedGoogleBillingAccountId } from "../_shared/googleBillingAccountBinding.mjs";
import { verifyNativePurchaseForBinding } from "../_shared/nativePurchaseVerification.mjs";

const headers={
  "content-type":"application/json","cache-control":"no-store",
  "referrer-policy":"no-referrer","x-content-type-options":"nosniff",
};
const uuid=(v:unknown):v is string=>typeof v==="string"&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const storeId=(v:unknown)=>typeof v==="string"&&
  /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(v)&&v.length<180;
const itemId=(v:unknown)=>typeof v==="string"&&
  /^[A-Za-z0-9_.-]{3,180}$/.test(v);
const reply=(status:number,code:string,extra?:Record<string,unknown>)=>
  new Response(JSON.stringify({code,...extra}),{status,headers});
const validEvidence=(v:unknown)=>{
  if(!v||typeof v!=="object"||Array.isArray(v))return false;
  const x=v as Record<string,unknown>;
  if(x.platform==="ios")return Object.keys(x).sort().join(",")==="platform,signedTransaction"&&
    typeof x.signedTransaction==="string"&&x.signedTransaction.length<=32768&&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(x.signedTransaction);
  if(x.platform==="android")return Object.keys(x).sort().join(",")==="platform,purchaseToken"&&
    typeof x.purchaseToken==="string"&&x.purchaseToken.length>=8&&
    x.purchaseToken.length<=2048&&/^[A-Za-z0-9._:-]+$/.test(x.purchaseToken);
  return false;
};
async function readBody(req:Request,max:number){
  const length=Number(req.headers.get("content-length")??0);
  if(!Number.isSafeInteger(length)||length>max||length<0)return null;
  const reader=req.body?.getReader();
  if(!reader)return null;
  let size=0,parts:Uint8Array[]=[];
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      if(!value)continue;
      size+=value.byteLength;
      if(size>max){await reader.cancel();return null}
      parts.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }catch{return null}
}
const privateKey=(v:string|undefined)=>v?.replace(/\\n/g,"\n")??"";
Deno.serve(async(req:Request)=>{
  if(Deno.env.get("ALLIN_NATIVE_BILLING_SANDBOX_ARMED")!=="true")
    return reply(503,"native_billing_disabled");
  if(req.method!=="GET"&&req.method!=="POST")
    return reply(405,"method_not_allowed");
  const authorization=req.headers.get("authorization")??"";
  if(!/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(authorization)||
     authorization.length>4096)return reply(401,"unauthorized");
  const env=(key:string)=>Deno.env.get(key)?.trim()??"";
  const url=env("SUPABASE_URL"),key=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return reply(503,"native_billing_disabled");
  const db=createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data,error}=await db.auth.getUser(authorization.slice(7));
  const owner=data?.user?.id;
  if(error||!uuid(owner))return reply(401,"unauthorized");

  const googlePackage=env("ALLIN_V2_ANDROID_PACKAGE"),
    googleProduct=env("ALLIN_ANDROID_MONTHLY_PRODUCT_ID"),
    googlePlan=env("ALLIN_ANDROID_BASE_PLAN_ID"),
    googlePepper=env("ALLIN_GOOGLE_BILLING_ACCOUNT_PEPPER");
  const appleBundle=env("ALLIN_V2_IOS_BUNDLE_ID"),
    appleProduct=env("ALLIN_IOS_MONTHLY_PRODUCT_ID");

  // A one-way obfuscated Google account identifier must be present in the
  // actual Play Billing purchase request for the server owner check to pass.
  if(req.method==="GET"){
    if(!storeId(googlePackage)||!itemId(googleProduct)||!itemId(googlePlan)||
       !storeId(appleBundle)||!itemId(appleProduct))
      return reply(503,"native_billing_disabled");
    const googleAccountId=await obfuscatedGoogleBillingAccountId({
      ownerId:owner,environment:"sandbox",serverPepper:googlePepper,
    });
    if(!googleAccountId)return reply(503,"native_billing_disabled");
    return reply(200,"native_billing_context",{
      ios:{productId:appleProduct,appAccountToken:owner},
      android:{productId:googleProduct,basePlanId:googlePlan,
        obfuscatedAccountId:googleAccountId},
    });
  }
  const evidence=await readBody(req,36*1024);
  if(!validEvidence(evidence))return reply(400,"invalid_evidence");
  const platform=(evidence as {platform:string}).platform;
  const nowMs=Date.now();
  let appleAdapters=null,googleTransport=null;
  if(platform==="ios"){
    const roots=env("ALLIN_APPLE_ROOT_CA_DER_BASE64").split(",").filter(Boolean);
    const appleKey=privateKey(env("ALLIN_APPLE_SERVER_PRIVATE_KEY"));
    const keyId=env("ALLIN_APPLE_SERVER_KEY_ID");
    const issuerId=env("ALLIN_APPLE_SERVER_ISSUER_ID");
    if(!storeId(appleBundle)||!itemId(appleProduct)||
       !roots.length||roots.length>4||!appleKey||!keyId||!issuerId)
      return reply(503,"native_billing_disabled");
    try{
      const verifier=new SignedDataVerifier(
        roots.map(c=>Buffer.from(c,"base64")),true,
        Environment.SANDBOX,appleBundle);
      const serverApi=new AppStoreServerAPIClient(
        appleKey,keyId,issuerId,appleBundle,Environment.SANDBOX);
      appleAdapters=createAppleStoreServerAdapters({
        verifier,serverApi,expectedBundleId:appleBundle,
        expectedProductId:appleProduct,expectedEnvironment:"Sandbox",
        clockMs:()=>Date.now(),
      });
    }catch{return reply(503,"native_billing_disabled")}
    if(!appleAdapters)return reply(503,"native_billing_disabled");
  }else{
    const email=env("ALLIN_GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const keyPem=privateKey(env("ALLIN_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"));
    if(!storeId(googlePackage)||!itemId(googleProduct)||!itemId(googlePlan))
      return reply(503,"native_billing_disabled");
    const getAccessToken=createGoogleServiceAccountAccessToken({
      serviceAccountEmail:email,privateKeyPem:keyPem,
      clockSeconds:()=>Math.floor(Date.now()/1000),
      request:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)}),
    });
    if(!getAccessToken)return reply(503,"native_billing_disabled");
    googleTransport=createGooglePlayDeveloperTransport({
      expectedPackageName:googlePackage,getAccessToken,
      request:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)}),
    });
    if(!googleTransport||!googlePepper)
      return reply(503,"native_billing_disabled");
  }
  const singleOwner=async(args:Record<string,unknown>)=>{
    const {data,error}=await db.rpc("v2_billing_find_native_purchase_owner",args);
    if(error||!Array.isArray(data)||data.length>1)
      throw Error("native_purchase_owner_unavailable");
    return data.length?data[0].owner_id:null;
  };
  const result=await verifyNativePurchaseForBinding({
    platform,authenticatedOwnerId:owner,rawEvidence:evidence,
    appleConfig:{bundleId:appleBundle,productId:appleProduct,environment:"Sandbox"},
    verifyAppleSignedJws:appleAdapters?.verifySignedJws,
    verifyAppleCurrentStatus:appleAdapters?.verifyCurrentStatus,
    googleConfig:{packageName:googlePackage,productId:googleProduct,
      basePlanId:googlePlan,environment:"sandbox"},
    fetchGoogleSubscription:async(args:Record<string,unknown>)=>{
      const purchase=await googleTransport.fetchSubscription(args);
      // This endpoint is SANDBOX ONLY: a live Play purchase must not become
      // a test entitlement. License tester purchases expose testPurchase.
      if(!purchase?.testPurchase||typeof purchase.testPurchase!=="object")
        throw Error("google_sandbox_evidence_missing");
      return purchase;
    },
    acknowledgeGoogleSubscription:googleTransport?.acknowledgeSubscription,
    googleAccountPepper:googlePepper,
    nowMs,
    findBoundOwner:async({provider,providerSubscriptionId}:{
      provider:string;providerSubscriptionId:string;
    })=>await singleOwner({
      p_provider:provider,p_environment:"sandbox",
      p_subscription_id:providerSubscriptionId,
    }),
    commitOwnerBoundPurchase:async fact=>{
      if(fact.verificationSource!=="provider_current"||!fact.providerEventId)
        throw Error("native_proof_invalid");
      const {data,error}=await db.rpc("v2_billing_commit_verified_native",{
        p_owner_id:owner,p_provider:fact.provider,p_environment:"sandbox",
        p_subscription_id:fact.providerSubscriptionId,
        p_event_id:fact.providerEventId,p_phase:fact.phase,
        p_access_until:fact.accessUntil===null?null:
          new Date(fact.accessUntil).toISOString(),
      });
      if(error)throw Error("native_commit_failed");
      return data;
    },
  });
  if(result.status==="provider_verified_and_persisted")
    return reply(200,"verified");
  if(result.status==="purchase_owned_by_another_account")
    return reply(409,"purchase_owned_by_another_account");
  if(result.status==="acknowledgement_required")
    return reply(503,"acknowledgement_required");
  return reply(503,"verification_unavailable");
});
