# V2 Stripe web billing sandbox

Use an isolated Supabase instance and the Durben Ventures Stripe sandbox. The
function rejects live Stripe keys and the known V1 and V2 canonical project
hosts. The database migration is for an isolated replay of the V2 source
migrations. Reconcile the canonical database's migration IDs separately.

1. In Stripe's sandbox, create one active USD 9.99 monthly recurring price and
   configure the default Customer Portal to allow payment method changes and
   cancellation at period end. Use a server-only sandbox API key with access to
   Prices, Customers, Subscriptions, Checkout Sessions, and Portal Sessions.
2. Apply the migrations to the isolated database, and serve or deploy
   `v2-stripe-billing` there. Set `STRIPE_SANDBOX_SECRET_KEY`,
   `STRIPE_SANDBOX_PRICE_ID`, `STRIPE_SANDBOX_WEB_ORIGIN`, and
   `STRIPE_SANDBOX_WEBHOOK_SECRET` through the server's secret settings. Use the
   signing secret for that specific destination or Stripe CLI listener.
3. Point a Stripe sandbox webhook at
   `/functions/v1/v2-stripe-billing/webhook`. Subscribe to Checkout completion,
   subscription created/updated/deleted/paused/resumed, and invoice paid/payment
   failed events. Stripe signs this route. The other routes require a valid V2
   Supabase user token.
4. From the configured web origin, send authenticated POST requests to
   `/functions/v1/v2-stripe-billing/checkout`, `/portal`, or `/status` (the
   latter two paths use the same function prefix). Redirect to the URL returned
   by Checkout or Portal. The web client owns the `/billing` and
   `/billing/success` pages. On return from Checkout, read status from the server.

The first Checkout subscription for a linked customer includes a seven-day
card-on-file trial. Retries reuse the same Checkout reservation for up to one
hour. A canceled Checkout page can be reopened while the session is open.
Trialing and active subscriptions grant access through their verified end
time. Past-due status suspends access in this sandbox and a successful recovery
restores it. Stripe refunds alone leave subscription status unchanged. To
test revocation, refund and cancel the subscription in Stripe.

Test a trial, a renewal and failed-payment recovery, cancellation, and replayed
or out-of-order webhooks. Compare status with Stripe after each transition. Also
test an invalid signature, a missing login, and access from a second V2 account.

Before live billing, settle tax and grace-period policy, add monitoring and
scheduled reconciliation, handle deletion of an account with an ongoing
subscription, and connect the canonical entitlement to the app access gate.
Native purchase and restore flows are tracked separately in ALL-252.
