// ALL-252 — STAGED ONLY. Do not deploy/arm until ALL-222 approval and
// reviewed V2 private checkout schema/service-role grants are installed.
// Web-only Stripe sandbox checkout. Native in-app purchases use Apple/Google.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createStripeSandboxSecretAdapter } from "../_shared/stripeSandboxSecretAdapter.mjs";
import { createCheckoutTrustAdapters } from "../_shared/stripeCheckoutTrustAdapters.mjs";
import { handleStripeSandboxCheckoutRequest } from "../_shared/stripeCheckoutRequest.mjs";

const jsonHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
function reply(status: number, code: string, checkoutUrl?: string, origin?: string) {
  return new Response(JSON.stringify(checkoutUrl ? { code, checkoutUrl } : { code }), {
    status, headers: { ...jsonHeaders,
      ...(origin ? { "access-control-allow-origin": origin,
        "vary": "Origin" } : {}) },
  });
}
function approvedOrigin(value: string | undefined) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.origin === value &&
      !u.username && !u.password ? value : null;
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  // A source-controlled, DEFAULT-OFF gate is independent of Stripe credentials.
  if (Deno.env.get("ALLIN_BILLING_SANDBOX_ARMED") !== "true")
    return reply(503, "checkout_disabled");

  const origin = approvedOrigin(Deno.env.get("ALLIN_BILLING_RETURN_ORIGIN"));
  if (!origin) return reply(503, "checkout_disabled");
  if (req.headers.has("origin") && req.headers.get("origin") !== origin)
    return reply(403, "origin_not_allowed");
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204, headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, apikey, content-type",
        "access-control-max-age": "600", "vary": "Origin",
      },
    });
  }
  if (req.method !== "POST") return reply(405, "method_not_allowed",undefined,origin);

  // Checkout requests have ZERO client-controlled body fields. Do not accept
  // ownerId, trial eligibility, price, redirects or provider session IDs.
  const length = Number(req.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > 0) return reply(400,"body_not_allowed",undefined,origin);
  if (req.body) {
    try {
      const reader = req.body.getReader();
      const first = await reader.read();
      await reader.cancel();
      if (!first.done && first.value?.byteLength)
        return reply(400,"body_not_allowed",undefined,origin);
    } catch { return reply(400,"body_not_allowed",undefined,origin); }
  }
  const serviceUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("ALLIN_STRIPE_SANDBOX_SECRET_KEY");
  const merchantId = Deno.env.get("ALLIN_STRIPE_SANDBOX_MERCHANT_ID");
  const priceId = Deno.env.get("ALLIN_STRIPE_SANDBOX_MONTHLY_PRICE_ID");
  if (!serviceUrl || !serviceKey || !stripeKey || !merchantId || !priceId)
    return reply(503,"checkout_disabled",undefined,origin);
  const db = createClient(serviceUrl,serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  // Only these public RPCs may access the private owner-bound ledger, and
  // only as service_role; each checks current_user and revokes client access.
  const trust = createCheckoutTrustAdapters({
    authGetUser: token => db.auth.getUser(token),
    claimPrivateTrial: args => db.rpc("v2_billing_claim_trial_checkout",
      {p_owner_id:args.p_owner_id}),
    claimPrivatePaid: args => db.rpc("v2_billing_claim_paid_checkout",
      {p_owner_id:args.p_owner_id}),
  });
  const stripe = createStripeSandboxSecretAdapter({
    secretKey:stripeKey,expectedMerchantAccountId:merchantId,
    approvedPriceId:priceId,
    request:(url,init)=>fetch(url,{
      ...init,signal:AbortSignal.timeout(10000),
    }),
  });
  if (!trust || !stripe) return reply(503,"checkout_disabled",undefined,origin);

  const result = await handleStripeSandboxCheckoutRequest({
    method:req.method,
    authorization:req.headers.get("authorization"),
    rawBody:new Uint8Array(),
    authenticateBearer:trust.authenticateBearer,
    claimEligibleAttempt:trust.claimEligibleAttempt,
    claimPaidAttempt:trust.claimPaidAttempt,
    reserveCheckoutAttempt:async ({attemptId,ownerId}) => {
      const {data,error}=await db.rpc("v2_billing_verify_checkout_reservation",
        {p_attempt_id:attemptId,p_owner_id:ownerId});
      if(error)throw Error("reservation_unavailable");
      return data;
    },
    registerPendingCheckout:async ({attemptId,ownerId,providerCheckoutId}) => {
      const {data,error}=await db.rpc("v2_billing_register_pending_checkout",
        {p_attempt_id:attemptId,p_owner_id:ownerId,p_checkout_id:providerCheckoutId});
      if(error)throw Error("registration_unavailable");
      return data;
    },
    createCheckoutSession:stripe.createCheckoutSession,
    priceId,merchantAccountId:merchantId,
    approvedReturnOrigin:origin,
    successUrl:origin+"/billing/success",
    cancelUrl:origin+"/billing/cancel",
  });
  return reply(result.status,result.code,result.checkoutUrl,origin);
});
