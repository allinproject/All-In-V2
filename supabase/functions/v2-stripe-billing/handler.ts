const STRIPE_VERSION = "2026-10-28.endive";
const EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);
const TERMINAL = new Set(["canceled", "incomplete_expired"]);

type Subscription = {
  id: string;
  status: string;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  items: { data: { price: { id: string }; current_period_end: number }[] };
};

type Account = {
  customer_id: string;
  revision: number;
  subscription_status: string | null;
  access_until: string | null;
  cancel_at_period_end: boolean;
};

type Config = {
  database: string;
  serviceKey: string;
  stripeKey: string;
  webhookSecret: string;
  price: string;
  webOrigin: string;
};

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export async function validSignature(
  body: string,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([name]) => name === "t")?.[1] ?? "";
  if (
    !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300
  ) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const payload = encoder.encode(timestamp + "." + body);
  for (const [name, value] of parts) {
    if (name === "v1" && /^[0-9a-f]{64}$/i.test(value ?? "")) {
      const signature = Uint8Array.from(
        value.match(/../g)!,
        (byte) => parseInt(byte, 16),
      );
      if (await crypto.subtle.verify("HMAC", key, signature, payload)) {
        return true;
      }
    }
  }
  return false;
}

export function subscriptionSnapshot(
  subscriptions: Subscription[],
  price: string,
) {
  const matching = subscriptions.filter((subscription) =>
    subscription.items.data.some((item) => item.price.id === price)
  );
  const subscription = matching.find((row) => !TERMINAL.has(row.status)) ??
    matching[0];
  const status = subscription?.status ?? null;
  const periodEnd = subscription?.items.data.find((item) =>
    item.price.id === price
  )?.current_period_end;
  const expiry = status === "trialing"
    ? subscription?.trial_end
    : status === "active"
    ? periodEnd
    : null;
  return {
    subscription: subscription?.id ?? null,
    status,
    until: expiry ? new Date(expiry * 1000).toISOString() : null,
    cancel: subscription?.cancel_at_period_end ?? false,
  };
}

export function readConfig(): Config {
  const database = new URL(Deno.env.get("SUPABASE_URL") ?? "");
  const web = new URL(Deno.env.get("STRIPE_SANDBOX_WEB_ORIGIN") ?? "");
  const stripeKey = Deno.env.get("STRIPE_SANDBOX_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_SANDBOX_WEBHOOK_SECRET") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const price = Deno.env.get("STRIPE_SANDBOX_PRICE_ID") ?? "";
  const localWeb = web.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(web.hostname);
  if (
    database.hostname.startsWith("xarhuczrtzuiljmtdaeu.") ||
    database.hostname.startsWith("impulecgsgaruvniuttc.") ||
    (!localWeb && web.protocol !== "https:") || web.username || web.password ||
    !/^(sk|rk)_test_/.test(stripeKey) || !webhookSecret.startsWith("whsec_") ||
    !price.startsWith("price_") || !serviceKey
  ) throw new HttpError(503, "sandbox_configuration_required");
  return {
    database: database.origin,
    webOrigin: web.origin,
    stripeKey,
    webhookSecret,
    serviceKey,
    price,
  };
}

export function billingHandler(config: Config, requestFetch = fetch) {
  async function json<T>(url: string, options: RequestInit): Promise<T> {
    const response = await requestFetch(url, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new HttpError(502, "billing_upstream_error");
    return await response.json();
  }

  function rpc<T>(name: string, args: Record<string, unknown>) {
    return json<T>(config.database + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        authorization: "Bearer " + config.serviceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
  }

  function stripe<T>(
    path: string,
    form?: Record<string, string>,
    key?: string,
  ) {
    const headers = new Headers({
      authorization: "Bearer " + config.stripeKey,
      "stripe-version": STRIPE_VERSION,
    });
    if (key) headers.set("idempotency-key", key);
    return json<T>("https://api.stripe.com/v1/" + path, {
      headers,
      method: form ? "POST" : "GET",
      body: form ? new URLSearchParams(form) : undefined,
    });
  }

  function account(user: string | null, customer: string | null = null) {
    return rpc<Account | null>("v2_stripe_account", {
      p_user: user,
      p_customer: customer,
    });
  }

  async function subscriptions(customer: string) {
    const query = new URLSearchParams({
      customer,
      status: "all",
      limit: "100",
    });
    const result = await stripe<{ data: Subscription[]; has_more: boolean }>(
      "subscriptions?" + query,
    );
    if (result.has_more) {
      throw new HttpError(503, "subscription_review_required");
    }
    return result.data;
  }

  async function userId(request: Request) {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      throw new HttpError(401, "authentication_required");
    }
    const response = await requestFetch(config.database + "/auth/v1/user", {
      headers: { apikey: config.serviceKey, authorization },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, "authentication_required");
    }
    if (!response.ok) throw new HttpError(502, "authentication_unavailable");
    const user = await response.json();
    if (!user.id) throw new HttpError(401, "authentication_required");
    return user.id as string;
  }

  async function checkout(user: string, existing: Account | null) {
    const price = await stripe<{
      active: boolean;
      livemode: boolean;
      unit_amount: number;
      currency: string;
      recurring: {
        interval: string;
        interval_count: number;
        usage_type: string;
      } | null;
    }>("prices/" + encodeURIComponent(config.price));
    if (
      !price.active || price.livemode !== false || price.unit_amount !== 999 ||
      price.currency !== "usd" || price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== "licensed"
    ) throw new HttpError(503, "sandbox_price_invalid");

    let customer = existing?.customer_id;
    if (!customer) {
      const created = await stripe<{ id: string }>(
        "customers",
        {},
        "allin-v2-customer-" + user,
      );
      customer = await rpc<string>("v2_stripe_bind", {
        p_user: user,
        p_customer: created.id,
      });
    }

    const attempt = await rpc<{ id: string; expires: number }>(
      "v2_stripe_reserve_checkout",
      {
        p_user: user,
      },
    );
    const current = await subscriptions(customer);
    if (current.some((row) => !TERMINAL.has(row.status))) {
      throw new HttpError(409, "manage_existing_subscription");
    }

    const form: Record<string, string> = {
      mode: "subscription",
      customer,
      "line_items[0][price]": config.price,
      "line_items[0][quantity]": "1",
      payment_method_collection: "always",
      "payment_method_types[0]": "card",
      expires_at: String(attempt.expires),
      success_url: config.webOrigin + "/billing/success",
      cancel_url: config.webOrigin + "/billing",
    };
    // Existing session lookup also permits retries near the end of the reservation.
    const sessionQuery = new URLSearchParams({
      customer,
      status: "open",
      limit: "10",
    });
    const open = await stripe<
      { data: { url: string | null; client_reference_id: string | null }[] }
    >(
      "checkout/sessions?" + sessionQuery,
    );
    const reserved = open.data.find((row) =>
      row.client_reference_id === attempt.id
    );
    if (reserved?.url) return { url: reserved.url };
    if (attempt.expires - Date.now() / 1000 < 1801) {
      throw new HttpError(409, "checkout_reservation_pending");
    }
    form.client_reference_id = attempt.id;
    if (!current.length) form["subscription_data[trial_period_days]"] = "7";
    const session = await stripe<{ url: string | null; status: string }>(
      "checkout/sessions",
      form,
      "allin-v2-checkout-" + attempt.id,
    );
    if (!session.url || session.status !== "open") {
      throw new HttpError(409, "checkout_reservation_pending");
    }
    return { url: session.url };
  }

  async function webhook(request: Request) {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature") ?? "";
    if (!await validSignature(body, signature, config.webhookSecret)) {
      throw new HttpError(400, "invalid_webhook_signature");
    }
    const event = JSON.parse(body);
    if (
      event.livemode !== false || event.account || typeof event.id !== "string"
    ) {
      throw new HttpError(400, "invalid_sandbox_event");
    }
    const customer = event.data?.object?.customer;
    if (!EVENTS.has(event.type) || typeof customer !== "string") {
      return { received: true };
    }
    const linked = await account(null, customer);
    if (!linked) return { received: true };
    const snapshot = subscriptionSnapshot(
      await subscriptions(customer),
      config.price,
    );
    const result = await rpc<string>("v2_stripe_apply_event", {
      p_event: event.id,
      p_customer: customer,
      p_revision: linked.revision,
      p_subscription: snapshot.subscription,
      p_status: snapshot.status,
      p_until: snapshot.until,
      p_cancel: snapshot.cancel,
    });
    // A concurrent update won the write. Stripe retries against a fresh snapshot.
    if (result === "retry") throw new HttpError(503, "retry_webhook");
    return { received: true };
  }

  return async (request: Request) => {
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    if (request.headers.get("origin") === config.webOrigin) {
      headers.set("access-control-allow-origin", config.webOrigin);
      headers.set("access-control-allow-methods", "POST, OPTIONS");
      headers.set(
        "access-control-allow-headers",
        "authorization, apikey, content-type",
      );
      headers.set("vary", "origin");
    }
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    try {
      const action = new URL(request.url).pathname.split("/").at(-1);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "POST") {
        return reply({ error: "method_not_allowed" }, 405);
      }
      if (action === "webhook") return reply(await webhook(request));
      if (!["checkout", "portal", "status"].includes(action ?? "")) {
        return reply({ error: "not_found" }, 404);
      }
      const user = await userId(request);
      const existing = await account(user);
      if (action === "checkout") return reply(await checkout(user, existing));
      if (action === "portal") {
        if (!existing) throw new HttpError(409, "billing_account_required");
        return reply(
          await stripe<{ url: string }>("billing_portal/sessions", {
            customer: existing.customer_id,
            return_url: config.webOrigin + "/billing",
          }).then(({ url }) => ({ url })),
        );
      }
      const until = existing?.access_until ?? null;
      return reply({
        status: existing?.subscription_status ?? null,
        access_until: until,
        has_access: until !== null && Date.parse(until) > Date.now(),
        cancel_at_period_end: existing?.cancel_at_period_end ?? false,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return reply({ error: error.code }, error.status);
      }
      return reply({ error: "billing_unavailable" }, 503);
    }
  };
}
