// ALL-252 — STAGED ONLY. External webhook auth is Stripe HMAC, NOT JWT.
// Default OFF until ALL-222 approves the private ledger + public service RPCs,
// real provider end-to-end tests and a configured sandbox webhook destination.
// Never route this to live Stripe or enable native subscriptions through web.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createStripeSandboxSecretAdapter } from "../_shared/stripeSandboxSecretAdapter.mjs";
import { confirmStripeCheckoutForBinding } from "../_shared/stripeCheckoutConfirmation.mjs";
import { reconcileStripeSandboxWebhook } from "../_shared/stripeWebhookReconciliation.mjs";

const headers={"content-type":"application/json","cache-control":"no-store"};
function reply(status:number,code:string){
  return new Response(JSON.stringify({code}),{status,headers});
}
async function readLimited(req:Request,max:number){
  if(req.headers.has("content-length")){
    const n=Number(req.headers.get("content-length"));
    if(!Number.isSafeInteger(n)||n>max||n<0)return null;
  }
  const reader=req.body?.getReader();
  if(!reader)return null;
  const chunks:Uint8Array[]=[];
  let count=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      if(!value)continue;
      count+=value.byteLength;
      if(count>max){await reader.cancel();return null;}
      chunks.push(value);
    }
  }catch{return null}
  const body=new Uint8Array(count);
  let offset=0;
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  return body;
}

Deno.serve(async(req:Request)=>{
  if(Deno.env.get("ALLIN_STRIPE_SANDBOX_WEBHOOK_ARMED")!=="true")
    return reply(503,"webhook_disabled");
  if(req.method!=="POST")return reply(405,"method_not_allowed");
  const serviceUrl=Deno.env.get("SUPABASE_URL");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey=Deno.env.get("ALLIN_STRIPE_SANDBOX_SECRET_KEY");
  const merchantId=Deno.env.get("ALLIN_STRIPE_SANDBOX_MERCHANT_ID");
  const priceId=Deno.env.get("ALLIN_STRIPE_SANDBOX_MONTHLY_PRICE_ID");
  const productId=Deno.env.get("ALLIN_STRIPE_SANDBOX_PRODUCT_ID");
  const secrets=(Deno.env.get("ALLIN_STRIPE_SANDBOX_WEBHOOK_SECRETS")??"")
    .split(",").map(value=>value.trim()).filter(Boolean);
  if(!serviceUrl||!serviceKey||!stripeKey||!merchantId||!priceId||
     !productId||!secrets.length||secrets.length>3)
    return reply(503,"webhook_disabled");

  const rawBody=await readLimited(req,256*1024);
  if(!rawBody)return reply(413,"payload_rejected");
  const db=createClient(serviceUrl,serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const stripe=createStripeSandboxSecretAdapter({
    secretKey:stripeKey,expectedMerchantAccountId:merchantId,
    approvedPriceId:priceId,
    request:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)}),
  });
  if(!stripe)return reply(503,"webhook_disabled");
  const singleRow=async(name:string,args:Record<string,unknown>)=>{
    const {data,error}=await db.rpc(name,args);
    if(error||!Array.isArray(data)||data.length!==1)
      throw Error("billing_private_lookup_unavailable");
    return data[0];
  };
  const result=await reconcileStripeSandboxWebhook({
    rawBody,signatureHeader:req.headers.get("stripe-signature"),
    webhookSecrets:secrets,nowSeconds:Math.floor(Date.now()/1000),
    approvedPriceId:priceId,approvedProductId:productId,
    retrieveCheckoutSession:stripe.retrieveCheckoutSession,
    retrieveSubscription:stripe.retrieveSubscription,
    commitAuthoritativeReconciliation:async entry=>{
      // Completion is initially unbound. Resolve its ORIGINAL server-owned
      // attempt by authenticated Stripe checkout ID, NEVER event metadata.
      if(entry.eventType.startsWith("checkout.session.")){
        const original=await singleRow("v2_billing_lookup_checkout",
          {p_checkout_id:entry.sourceObjectId});
        if(original.state==="pending"){
          const confirmation=await confirmStripeCheckoutForBinding({
            expectedOwnerId:original.owner_id,
            checkoutAttempt:{
              attemptId:original.attempt_id,ownerId:original.owner_id,
              provider:"stripe_web",environment:"sandbox",
              providerCheckoutId:original.provider_checkout_id,
              providerSubscriptionId:original.provider_subscription_id,
              state:"pending",
            },
            retrieveCheckoutSession:stripe.retrieveCheckoutSession,
            retrieveSubscription:stripe.retrieveSubscription,
            approvedPriceId:priceId,approvedProductId:productId,
            expectedLiveMode:false,
          });
          if(confirmation.status!=="confirmed_for_binding_transaction"||
             confirmation.providerPurchase.providerSubscriptionId!==
               entry.providerSubscriptionId)
            throw Error("checkout_unconfirmed");
        }else if(original.state!=="server_confirmed"||
          original.provider_subscription_id!==entry.providerSubscriptionId){
          throw Error("checkout_unconfirmed");
        }
        const {data,error}=await db.rpc("v2_billing_finalize_checkout",{
          p_attempt_id:original.attempt_id,p_owner_id:original.owner_id,
          p_checkout_id:entry.sourceObjectId,
          p_subscription_id:entry.providerSubscriptionId,
        });
        if(error||!["finalized","already_finalized"].includes(data))
          throw Error("checkout_finalization_failed");
      }
      const bound=await singleRow("v2_billing_lookup_purchase",{
        p_subscription_id:entry.providerSubscriptionId,
      });
      if(bound.provider_subscription_id!==entry.providerSubscriptionId)
        throw Error("unbound_purchase");
      const {data,error}=await db.rpc("v2_billing_apply_current_subscription_event",{
        p_owner_id:bound.owner_id,
        p_subscription_id:entry.providerSubscriptionId,
        p_event_id:entry.providerEventId,
        p_phase:entry.verifiedProjection.phase,
        p_access_until:entry.verifiedProjection.accessUntil,
      });
      if(error)throw Error("subscription_ledger_unavailable");
      if(data==="applied")return "committed";
      if(data==="duplicate")return "duplicate";
      throw Error("subscription_reconciliation_unavailable");
    },
  });
  return reply(result.status,result.code);
});
