/**
 * ALL-252: USD founder-approved subscription offer compatibility contract.
 * This is a source/offer filter, NOT a payment API, checkout, provider catalog,
 * trial-eligibility validator, or proof of paid access.
 */
export type PurchaseSurface = 'ios_native' | 'android_native' | 'web';
export type CheckoutProvider = 'app_store' | 'google_play' | 'stripe_web';

export type SubscriptionOfferCandidate = Readonly<{
  surface: PurchaseSurface;
  provider: CheckoutProvider;
  currency: string;
  amountMinor: number;
  billingInterval: 'month' | 'year';
  billingIntervalCount: number;
  trialDays: number;
  trialEligible: boolean;
  providerOfferId: string;
}>;

export type OfferDecision = 'approved_for_test' | 'ineligible_trial' | 'not_approved';

const allowedProvider: Readonly<Record<PurchaseSurface, CheckoutProvider>> = {
  ios_native: 'app_store',
  android_native: 'google_play',
  web: 'stripe_web',
};

const approvedStripeSandboxPrice = 'price_1UaDovRBJdOnJBog5swb8zpS';

/**
 * Only authorize an offer for non-live integration testing.
 * Live product IDs, storefront pricing/regions and trial eligibility require
 * separate provider-side configuration, verification and founder approval.
 *
 * Stripe price IDs here are SANDBOX ONLY. No Stripe price is accepted on
 * an iOS or Android native purchase surface.
 */
export function reviewSandboxSubscriptionOffer(candidate: SubscriptionOfferCandidate): OfferDecision {
  if (!candidate || !Object.hasOwn(allowedProvider, candidate.surface) ||
      candidate.provider !== allowedProvider[candidate.surface] ||
      candidate.currency !== 'usd' || !Number.isSafeInteger(candidate.amountMinor) ||
      candidate.amountMinor !== 999 || candidate.billingInterval !== 'month' ||
      candidate.billingIntervalCount !== 1 || candidate.trialDays !== 7 ||
      !candidate.providerOfferId?.trim()) return 'not_approved';

  if (candidate.surface === 'web' && candidate.providerOfferId !== approvedStripeSandboxPrice) {
    return 'not_approved';
  }
  // This policy never grants a second trial to someone ineligible; no
  // provider/verified entitlement bypass is possible from this local result.
  if (!candidate.trialEligible) return 'ineligible_trial';
  return 'approved_for_test';
}
