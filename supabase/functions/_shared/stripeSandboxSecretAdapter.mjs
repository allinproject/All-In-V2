/**
 * ALL-252 — staged server-only Stripe sandbox HTTP adapter.
 * No deployed handler, credentials, payments or network calls at import time.
 * The caller injects an authenticated secret-key and the server fetch API.
 * Never import from mobile code or use EXPO_PUBLIC_* credentials.
 *
 * The trusted adapter intentionally refuses live keys and live objects.
 * Stripe-Account is NOT accepted from requests: merchant identity is checked
 * by a secret-key GET /v1/account response, not customer metadata or a
 * fabricated account ID on a Checkout Session.
 */
const validId=(s,prefix)=>typeof s==='string'&&s.startsWith(prefix)&&
  /^[A-Za-z0-9_]+$/.test(s)&&s.length<=256;
const uuid=s=>typeof s==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const safeUrl=s=>typeof s==='string'&&s.length<2048&&
  (()=>{try{const u=new URL(s);return u.protocol==='https:' &&
    !u.username&&!u.password;}catch{return false}})();

function normalizeSubscription(raw){
  if(!raw||typeof raw!=='object')return null;
  // The provider's canonical object is returned to the validation layer
  // without reinterpreting access or ownership.
  return raw;
}

export function createStripeSandboxSecretAdapter({
  secretKey, expectedMerchantAccountId, approvedPriceId, request,
}={}){
  if(typeof secretKey!=='string'||!secretKey.startsWith('sk_test_')||
     secretKey.length<20||!validId(expectedMerchantAccountId,'acct_')||
     !validId(approvedPriceId,'price_')||
     typeof request!=='function')return null;

  const requestJson=async(method,path,{params,idempotencyKey}={})=>{
    if(!/^\/v1\/[a-zA-Z0-9_\/-]+$/.test(path)||
       !['GET','POST'].includes(method))throw Error('invalid_path');
    const headers={Authorization:'Bearer '+secretKey};
    if(method==='POST'){
      if(typeof idempotencyKey!=='string'||!uuid(
        idempotencyKey.replace(/^allin-v2-checkout-/,''))
         ||!idempotencyKey.startsWith('allin-v2-checkout-'))
        throw Error('invalid_idempotency');
      headers['Idempotency-Key']=idempotencyKey;
      headers['Content-Type']='application/x-www-form-urlencoded';
    }
    let response;
    try{
      response=await request('https://api.stripe.com'+path,{
        method,headers,
        ...(method==='POST'?{body:new URLSearchParams(params).toString()}:{})
      });
    }catch{throw Error('stripe_unavailable')}
    if(!response||response.ok!==true)throw Error('stripe_unavailable');
    let body;
    try{body=await response.json()}catch{throw Error('stripe_invalid_response')}
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw Error('stripe_invalid_response');
    return body;
  };
  // The account query must precede EACH read/create operation; no stale
  // authenticated merchant assertion is retained between requests.
  const assertMerchant=async()=>{
    const account=await requestJson('GET','/v1/account');
    if(account.id!==expectedMerchantAccountId)throw Error('merchant_mismatch');
  };
  return Object.freeze({
    async createCheckoutSession(input){
      if(!input||input.merchantAccountId!==expectedMerchantAccountId||
         input.mode!=='subscription'||!uuid(input.client_reference_id)||
         !Array.isArray(input.line_items)||input.line_items.length!==1||
         input.line_items[0]?.price!==approvedPriceId||
         input.line_items[0].quantity!==1||
         input.subscription_data?.trial_period_days!==7||
         !safeUrl(input.success_url)||!safeUrl(input.cancel_url)||
         input.idempotencyKey!=='allin-v2-checkout-'+input.client_reference_id)
        throw Error('invalid_checkout_request');
      await assertMerchant();
      const params={
        mode:'subscription',
        'line_items[0][price]':input.line_items[0].price,
        'line_items[0][quantity]':'1',
        'subscription_data[trial_period_days]':'7',
        client_reference_id:input.client_reference_id,
        success_url:input.success_url,
        cancel_url:input.cancel_url,
      };
      const result=await requestJson('POST','/v1/checkout/sessions',{
        params,idempotencyKey:input.idempotencyKey,
      });
      if(result.livemode!==false)throw Error('environment_mismatch');
      return {...result,merchantAccountId:expectedMerchantAccountId};
    },
    async retrieveCheckoutSession(checkoutId){
      if(!validId(checkoutId,'cs_'))throw Error('invalid_checkout_id');
      await assertMerchant();
      const result=await requestJson('GET','/v1/checkout/sessions/'+checkoutId);
      if(result.id!==checkoutId||result.livemode!==false)
        throw Error('environment_mismatch');
      return result;
    },
    async retrieveSubscription(subscriptionId){
      if(!validId(subscriptionId,'sub_'))throw Error('invalid_subscription_id');
      await assertMerchant();
      const result=await requestJson('GET','/v1/subscriptions/'+subscriptionId);
      if(result.id!==subscriptionId||result.livemode!==false)
        throw Error('environment_mismatch');
      return normalizeSubscription(result);
    },
  });
}
