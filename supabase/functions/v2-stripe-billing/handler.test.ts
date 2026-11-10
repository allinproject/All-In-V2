import {
  billingHandler,
  subscriptionSnapshot,
  validSignature,
} from "./handler.ts";

const config = {
  database: "http://127.0.0.1:54321",
  webOrigin: "http://localhost:3000",
  serviceKey: "test-service-role",
  stripeKey: "sk_test_placeholder",
  webhookSecret: "whsec_placeholder",
  price: "price_sandbox",
};

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "Expected " + JSON.stringify(expected) + ", got " +
        JSON.stringify(actual),
    );
  }
}

async function signature(body: string, time = Math.floor(Date.now() / 1000)) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(time + "." + body),
  );
  const hex = Array.from(
    new Uint8Array(bytes),
    (value) => value.toString(16).padStart(2, "0"),
  );
  return "t=" + time + ",v1=" + hex.join("");
}

function subscription(status: string, price = config.price) {
  return {
    id: "sub_" + status,
    status,
    trial_end: 2_000_000_000,
    cancel_at_period_end: status === "active",
    items: {
      data: [{ price: { id: price }, current_period_end: 2_000_100_000 }],
    },
  };
}

Deno.test("signature accepts rotation and rejects tampering and stale deliveries", async () => {
  const header = await signature("{}");
  equal(
    await validSignature("{}", header + ",v1=wrong", config.webhookSecret),
    true,
  );
  equal(await validSignature("{ }", header, config.webhookSecret), false);
  equal(
    await validSignature(
      "{}",
      await signature("{}", 100),
      config.webhookSecret,
    ),
    false,
  );
});

Deno.test("only the configured subscription grants time-bounded access", () => {
  equal(
    subscriptionSnapshot([subscription("active", "price_other")], config.price)
      .until,
    null,
  );
  equal(
    subscriptionSnapshot([subscription("past_due")], config.price).until,
    null,
  );
  equal(
    subscriptionSnapshot([subscription("canceled")], config.price).until,
    null,
  );
  equal(
    subscriptionSnapshot([subscription("trialing")], config.price).until,
    new Date(2e12).toISOString(),
  );
  const active = subscriptionSnapshot([
    subscription("canceled"),
    subscription("active"),
  ], config.price);
  equal(active, {
    subscription: "sub_active",
    status: "active",
    until: new Date(2_000_100_000_000).toISOString(),
    cancel: true,
  });
});

Deno.test("unauthenticated routes and unsigned webhooks never call upstreams", async () => {
  const handler = billingHandler(config, () => {
    throw new Error("Unexpected upstream call");
  });
  for (const route of ["checkout", "portal", "status"]) {
    equal(
      (await handler(new Request("http://test/" + route, { method: "POST" })))
        .status,
      401,
    );
  }
  equal(
    (await handler(
      new Request("http://test/webhook", { method: "POST", body: "{}" }),
    )).status,
    400,
  );
});

Deno.test("late webhook uses current Stripe state and asks Stripe to retry on revision conflict", async () => {
  const body = JSON.stringify({
    id: "evt_test",
    livemode: false,
    type: "customer.subscription.updated",
    data: { object: { customer: "cus_owner", status: "canceled" } },
  });
  let write: Record<string, unknown> = {};
  const handler = billingHandler(config, async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/v2_stripe_account")) {
      equal(await new Response(init?.body).json(), {
        p_user: null,
        p_customer: "cus_owner",
      });
      return Response.json({ revision: 3 });
    }
    if (path.endsWith("/subscriptions")) {
      return Response.json({ data: [subscription("active")], has_more: false });
    }
    if (path.endsWith("/v2_stripe_apply_event")) {
      write = JSON.parse(String(init?.body));
      return Response.json("retry");
    }
    throw new Error("Unexpected upstream call");
  });
  const result = await handler(
    new Request("http://test/webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": await signature(body) },
    }),
  );
  equal(result.status, 503);
  equal(write.p_revision, 3);
  equal(write.p_status, "active");
});

Deno.test("Checkout uses a server-owned customer, price, trial, and idempotency key", async () => {
  let submitted: Record<string, string> = {};
  let idempotencyKey: string | null = null;
  const handler = billingHandler(config, async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/auth/v1/user")) {
      return Response.json({ id: "trusted-user" });
    }
    if (path.endsWith("/v2_stripe_account")) {
      const body = await new Response(init?.body).json();
      equal(body.p_user, "trusted-user");
      return Response.json({ customer_id: "cus_trusted" });
    }
    if (path.endsWith("/prices/price_sandbox")) {
      return Response.json({
        active: true,
        livemode: false,
        unit_amount: 999,
        currency: "usd",
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "licensed",
        },
      });
    }
    if (path.endsWith("/v2_stripe_reserve_checkout")) {
      return Response.json({
        id: "attempt",
        expires: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    if (path.endsWith("/subscriptions") || init?.method === "GET") {
      return Response.json({ data: [], has_more: false });
    }
    if (path.endsWith("/checkout/sessions")) {
      submitted = Object.fromEntries(init?.body as URLSearchParams);
      idempotencyKey = new Headers(init?.headers).get("idempotency-key");
      return Response.json({
        url: "https://checkout.stripe.com/test",
        status: "open",
      });
    }
    throw new Error("Unexpected upstream call");
  });
  const result = await handler(
    new Request("http://test/checkout", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify({
        customer: "cus_untrusted",
        price: "price_untrusted",
      }),
    }),
  );
  equal(result.status, 200);
  equal(submitted.customer, "cus_trusted");
  equal(submitted["line_items[0][price]"], "price_sandbox");
  equal(submitted["subscription_data[trial_period_days]"], "7");
  equal(idempotencyKey, "allin-v2-checkout-attempt");
});
