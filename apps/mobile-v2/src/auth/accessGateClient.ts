import type { SupabaseClient, User } from '@supabase/supabase-js';

export type V2OnboardingState = {
  profileVersion: number;
  completedSteps: string[];
  skippedSteps: string[];
};

export type V2AccessResult = {
  needsOnboarding: boolean;
};

function positiveInt(value: unknown, fallback = 1): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function parsePendingLegalAcceptance(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const termsVersion = String(raw.terms_version ?? '').trim();
  const privacyVersion = String(raw.privacy_version ?? '').trim();
  const founderBetaTermsVersion = String(raw.founder_beta_terms_version ?? '').trim();
  const acceptedAt = String(raw.accepted_at ?? '').trim();
  const age18Confirmed = raw.age_18_confirmed === true;
  if ([termsVersion, privacyVersion, founderBetaTermsVersion].some(version =>
    !version || version.startsWith('pending-final-')
  ) || !age18Confirmed) return null;

  const parsed = new Date(acceptedAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(acceptedAt)
    || !Number.isFinite(parsed.getTime())
    || parsed.toISOString() !== acceptedAt) return null;

  return { termsVersion, privacyVersion, founderBetaTermsVersion, age18Confirmed: true as const, acceptedAt };
}

export function shouldEnterV2Onboarding(
  metadata: Record<string, unknown> | null | undefined,
  state: Pick<V2OnboardingState, 'completedSteps' | 'skippedSteps'>,
): boolean {
  if (metadata?.allin_training_onboarding_complete === true) return false;
  const count = new Set([...state.completedSteps, ...state.skippedSteps]).size;
  if (count > 0) return true;
  const legacySetup = Array.isArray(metadata?.allin_active_activities)
    || Array.isArray(metadata?.allin_capability_interests);
  return !legacySetup;
}

async function fetchOnboardingState(client: SupabaseClient): Promise<V2OnboardingState> {
  const { data, error } = await client.rpc('allin_my_profile_state');
  if (error) throw error;
  const profile = data?.profile ?? {};
  const progress = data?.onboarding ?? {};
  const allowedSteps = new Set(['focus', 'training_pattern', 'availability', 'coach', 'food_safety', 'proactivity']);
  const normalize = (value: unknown) => Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && allowedSteps.has(item)))]
    : [];
  return {
    profileVersion: positiveInt(profile.version),
    completedSteps: normalize(progress.completed_steps),
    skippedSteps: normalize(progress.skipped_steps),
  };
}

/**
 * Temporary V2 adapter kept behavior-compatible with Native/src/data/betaSignupClient.ts
 * and Native/src/data/onboardingClient.ts. Both apps continue to use the same canonical
 * profile/onboarding RPCs; this adapter creates no second record or writer.
 */
async function persistPendingLegalAcceptance(
  client: SupabaseClient,
  metadata: Record<string, unknown>,
  expectedUserId: string,
): Promise<boolean> {
  const pendingValue = metadata.allin_legal_acceptance_pending;
  const pending = parsePendingLegalAcceptance(pendingValue);
  if (!pending) return false;
  if (!expectedUserId) throw new Error('Legal acceptance account is required.');

  const state = await fetchOnboardingState(client);
  const requireOwner = async () => {
    const { data, error } = await client.auth.getUser();
    if (error || data.user?.id !== expectedUserId) throw new Error('Legal acceptance account changed.');
  };

  const acceptedAt = pending.acceptedAt;
  const legalAcceptance = {
    terms: { version: pending.termsVersion, accepted_at: acceptedAt },
    privacy: { version: pending.privacyVersion, accepted_at: acceptedAt },
    founder_beta_terms: { version: pending.founderBetaTermsVersion, accepted_at: acceptedAt },
    eligibility: { age_18_confirmed: true, confirmed_at: acceptedAt },
  };

  await requireOwner();
  const { error } = await client.rpc('allin_patch_profile_settings_section', {
    p_section: 'legal_acceptance',
    p_patch: legalAcceptance,
    p_expected_version: state.profileVersion,
    p_action_id: `legal-acceptance:${Date.now()}`,
  });
  if (error) throw error;
  await requireOwner();

  const updated = await client.auth.updateUser({ data: { allin_legal_acceptance_pending: null } });
  if (updated.error) throw updated.error;
  return true;
}

export async function resolveV2Access(
  client: SupabaseClient,
  user: Pick<User, 'id' | 'user_metadata'>,
): Promise<V2AccessResult> {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  if (metadata.allin_legal_acceptance_pending) {
    const saved = await persistPendingLegalAcceptance(client, metadata, user.id);
    if (!saved) throw new Error('Pending legal acceptance could not be verified.');
  }

  if (metadata.allin_training_onboarding_complete === true) {
    return { needsOnboarding: false };
  }

  const state = await fetchOnboardingState(client);
  return { needsOnboarding: shouldEnterV2Onboarding(metadata, state) };
}