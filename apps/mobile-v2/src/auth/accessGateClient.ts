import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

export const REQUIRED_V2_LEGAL_KEYS = ['terms', 'privacy', 'founder_beta_terms'] as const;
export type V2LegalDocumentKey = typeof REQUIRED_V2_LEGAL_KEYS[number];

export type V2LegalDocument = {
  document_key: V2LegalDocumentKey;
  version: string;
  title: string;
  content_markdown: string;
  content_sha256: string | null;
  effective_at: string;
};

export type V2OnboardingState = {
  completedSteps: string[];
  skippedSteps: string[];
};

export type V2AccessResult = {
  needsLegalAcceptance: boolean;
  needsOnboarding: boolean;
  requiredLegalDocuments: V2LegalDocument[];
};

function normalizedText(value: unknown, max = 50000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function parsePublishedV2LegalDocuments(value: unknown): V2LegalDocument[] {
  if (!Array.isArray(value)) throw new Error('V2 legal documents are not available yet.');
  const allowed = new Set<string>(REQUIRED_V2_LEGAL_KEYS);
  const parsed: V2LegalDocument[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('V2 legal document data is invalid.');
    }
    const item = raw as Record<string, unknown>;
    const documentKey = normalizedText(item.document_key, 40);
    const version = normalizedText(item.version, 120);
    const title = normalizedText(item.title, 200);
    const contentMarkdown = normalizedText(item.content_markdown);
    const effectiveAt = normalizedText(item.effective_at, 80);
    if (!allowed.has(documentKey) || !version || !title || !contentMarkdown || !effectiveAt) {
      throw new Error('A published V2 legal document is incomplete.');
    }
    if (parsed.some(document => document.document_key === documentKey)) {
      throw new Error('Duplicate V2 legal document key was returned.');
    }
    parsed.push({
      document_key: documentKey as V2LegalDocumentKey,
      version,
      title,
      content_markdown: contentMarkdown,
      content_sha256: normalizedText(item.content_sha256, 64) || null,
      effective_at: effectiveAt,
    });
  }

  if (parsed.length !== REQUIRED_V2_LEGAL_KEYS.length
    || REQUIRED_V2_LEGAL_KEYS.some(key => !parsed.some(document => document.document_key === key))) {
    throw new Error('V2 signup remains closed until Terms, Privacy and Founder Beta Terms are all published.');
  }

  return parsed.sort((a, b) => REQUIRED_V2_LEGAL_KEYS.indexOf(a.document_key) - REQUIRED_V2_LEGAL_KEYS.indexOf(b.document_key));
}

/** A review check applies only to the exact published legal document revision. */
export function v2LegalReviewKey(
  ownerId: string,
  document: Pick<V2LegalDocument, 'document_key' | 'version' | 'content_sha256'>,
): string {
  return JSON.stringify([ownerId, document.document_key, document.version, document.content_sha256]);
}

/** Account- and revision-specific consent scope for all legal review controls. */
export function v2LegalReviewSetKey(
  ownerId: string,
  documents: readonly Pick<V2LegalDocument, 'document_key' | 'version' | 'content_sha256'>[],
): string {
  return JSON.stringify(documents.map(document => v2LegalReviewKey(ownerId, document)));
}

/** Prior to account creation, bind age confirmation and acceptance retries to the email and legal set. */
export function v2SignupConsentScope(
  email: string,
  documents: readonly Pick<V2LegalDocument, 'document_key' | 'version' | 'content_sha256'>[],
): string {
  return JSON.stringify([email.trim().toLowerCase(), v2LegalReviewSetKey('signup', documents)]);
}

export function v2LegalAcceptanceMatches(
  acceptance: unknown,
  documents: V2LegalDocument[],
): boolean {
  if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) return false;
  const saved = acceptance as Record<string, unknown>;
  if (saved.age_18_confirmed !== true) return false;

  const byKey = new Map(documents.map(document => [document.document_key, document.version]));
  return saved.terms_version === byKey.get('terms')
    && saved.privacy_version === byKey.get('privacy')
    && saved.founder_beta_terms_version === byKey.get('founder_beta_terms');
}

export function shouldEnterV2Onboarding(
  _metadata: Record<string, unknown> | null | undefined,
  state: Pick<V2OnboardingState, 'completedSteps' | 'skippedSteps'>,
): boolean {
  const completed = new Set([...state.completedSteps, ...state.skippedSteps]);
  return !REQUIRED_V2_ONBOARDING_STEPS.every(step => completed.has(step));
}

export const REQUIRED_V2_ONBOARDING_STEPS = [
  'focus',
  'training_pattern',
  'availability',
  'coach',
  'food_safety',
  'proactivity',
] as const;

export async function resolveV2Access(
  client: SupabaseClient<Database>,
  user: Pick<User, 'id'>,
): Promise<V2AccessResult> {
  const { data, error } = await client.rpc('v2_my_profile_state');
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('V2 account state could not be verified.');
  }

  const state = data as Record<string, any>;
  if (String(state.profile?.user_id ?? '') !== user.id) {
    throw new Error('V2 profile is not ready for this account. Private access remains closed.');
  }

  const requiredLegalDocuments = parsePublishedV2LegalDocuments(state.required_legal_documents);
  const needsLegalAcceptance = !v2LegalAcceptanceMatches(
    state.latest_legal_acceptance,
    requiredLegalDocuments,
  );

  const onboarding = state.onboarding ?? {};
  const completedSteps = Array.isArray(onboarding.completed_steps)
    ? onboarding.completed_steps.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const skippedSteps = Array.isArray(onboarding.skipped_steps)
    ? onboarding.skipped_steps.filter((value: unknown): value is string => typeof value === 'string')
    : [];

  // The session may have changed while the account-state RPC was in flight.
  // Never return a positive gate decision for a different active account.
  await assertV2SessionOwner(client, user.id);

  return {
    needsLegalAcceptance,
    needsOnboarding: !needsLegalAcceptance && shouldEnterV2Onboarding(null, { completedSteps, skippedSteps }),
    requiredLegalDocuments,
  };
}

/** Fail closed when an auth-sensitive write is about to run under a different V2 account. */
export async function assertV2SessionOwner(
  client: SupabaseClient<Database>,
  expectedUserId: string,
): Promise<void> {
  const ownerId = expectedUserId.trim();
  if (!ownerId) throw new Error('A V2 account identity is required.');
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== ownerId) {
    throw new Error('The signed-in account changed. Sign in again before continuing.');
  }
}

/**
 * Only release a profile snapshot to a screen after both the returned
 * profile and the current session still belong to the expected account.
 */
export async function readV2OwnedProfileState(
  client: SupabaseClient<Database>,
  expectedUserId: string,
  isCurrent: () => boolean = () => true,
): Promise<Record<string, unknown>> {
  if (!expectedUserId.trim()) throw new Error('A V2 account identity is required.');
  if (!isCurrent()) throw new Error('The onboarding request is no longer active.');
  const { data, error } = await client.rpc('v2_my_profile_state');
  if (!isCurrent()) throw new Error('The onboarding request is no longer active.');
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('V2 account state could not be verified.');
  }
  const state = data as Record<string, unknown>;
  const profile = state.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)
    || (profile as Record<string, unknown>).user_id !== expectedUserId) {
    throw new Error('The account changed while onboarding was open. Private access remains closed.');
  }
  await assertV2SessionOwner(client, expectedUserId);
  if (!isCurrent()) throw new Error('The onboarding request is no longer active.');
  return state;
}
