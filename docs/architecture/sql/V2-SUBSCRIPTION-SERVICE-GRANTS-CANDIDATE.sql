-- ALL-222 / ALL-266 — billing service-role permission candidate.
-- REVIEW ONLY. NOT A VERSIONED MIGRATION AND NEVER APPLY TO LIVE V2.
-- This is the exact permission allowlist exercised by the disposable
-- PostgreSQL subscription replay; permission additions must update both
-- the catalog inventory and owner-bound security acceptance first.
-- Requires V2-SUBSCRIPTION-VERIFIED-LEDGER-CANDIDATE.sql in the same transaction.
-- Do not grant anon/authenticated/PUBLIC API access or expose private schema.

GRANT USAGE ON SCHEMA allin_private TO service_role;
GRANT SELECT,INSERT,UPDATE ON allin_private.v2_subscription_checkout_attempts TO service_role;
GRANT SELECT,INSERT,UPDATE ON allin_private.v2_subscription_purchases TO service_role;
GRANT SELECT,INSERT ON allin_private.v2_subscription_verified_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE allin_private.v2_subscription_verified_events_id_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_read_owner_access(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_lookup_purchase(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_verify_checkout_reservation(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_claim_trial_checkout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_claim_paid_checkout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_register_pending_checkout(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_finalize_checkout(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_lookup_checkout(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_apply_current_subscription_event(uuid,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_claim_paid_checkout_attempt(
  uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_claim_trial_checkout_attempt(
  uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_reserve_subscription_checkout(
  uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_register_pending_subscription_checkout(
  uuid,uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_confirm_pending_subscription_checkout(
  uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_find_native_purchase_owner(
 text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_billing_commit_verified_native(
 uuid,text,text,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_bind_verified_native_subscription(
 uuid,text,text,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_bind_confirmed_subscription_purchase(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_finalize_verified_subscription_checkout(
  uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_apply_verified_subscription_event(
  uuid,text,text,text,text,bigint,text,timestamptz) TO service_role;

